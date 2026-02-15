/**
 * Tests for Pipeline Orchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Pipeline from '../../src/pipeline';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock logging
vi.mock('../../src/logging', () => ({
    getLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Mock transcription module
vi.mock('../../src/transcription', () => ({
    create: vi.fn(() => ({
        transcribe: vi.fn().mockResolvedValue({
            text: 'This is a test transcription',
            model: 'whisper-1',
            duration: 1000,
        }),
        supportsStreaming: vi.fn(() => false),
        supportsDiarization: vi.fn(() => false),
        setDefaultModel: vi.fn(),
        getDefaultModel: vi.fn(() => 'whisper-1'),
    })),
}));

// Mock reasoning module
vi.mock('../../src/reasoning', () => ({
    create: vi.fn(() => ({
        complete: vi.fn().mockResolvedValue({
            content: 'Enhanced transcription text',
            model: 'gpt-4o-mini',
            duration: 500,
        }),
        executeWithStrategy: vi.fn(),
        isReasoningModel: vi.fn(() => true),
        getModelFamily: vi.fn(() => 'openai'),
        getRecommendedStrategy: vi.fn(() => 'simple'),
    })),
}));

// Mock agentic module
vi.mock('../../src/agentic', () => ({
    create: vi.fn(() => ({
        process: vi.fn().mockResolvedValue({
            enhancedText: '# Formatted Transcript\n\nThis is a test transcription',
            state: {
                originalText: 'test',
                correctedText: 'test',
                unknownEntities: [],
                resolvedEntities: new Map(),
                confidence: 0.9,
            },
            toolsUsed: ['lookup_person'],
            iterations: 2,
        }),
        getAvailableTools: vi.fn(() => ['lookup_person', 'lookup_project']),
    })),
}));

describe('Pipeline Orchestrator', () => {
    let tempDir: string;
  
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protokoll-pipeline-test-'));
    });
  
    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true });
    });
  
    describe('create', () => {
        it('should create a pipeline instance', async () => {
            const pipeline = await Pipeline.create({
                model: 'gpt-4o-mini',
                transcriptionModel: 'whisper-1',
                interactive: false,
                selfReflection: false,
                debug: false,
                intermediateDir: path.join(tempDir, 'output'),
                keepIntermediates: true,
                outputDirectory: path.join(tempDir, 'final'),
                outputStructure: 'month',
                outputFilenameOptions: ['date', 'time'],
                maxAudioSize: 25 * 1024 * 1024,
                tempDirectory: tempDir,
            });
      
            expect(pipeline).toBeDefined();
            expect(typeof pipeline.process).toBe('function');
        });
    });
  
    describe('process', () => {
        const createConfig = (overrides = {}) => ({
            model: 'gpt-4o-mini',
            transcriptionModel: 'whisper-1',
            interactive: false,
            selfReflection: false,
            debug: false,
            contextDirectory: tempDir,
            intermediateDir: path.join(tempDir, 'output'),
            keepIntermediates: true,
            outputDirectory: path.join(tempDir, 'final'),
            outputStructure: 'month',
            outputFilenameOptions: ['date', 'time'],
            maxAudioSize: 25 * 1024 * 1024,
            tempDirectory: tempDir,
            ...overrides,
        });

        it('should process input and return result', async () => {
            const pipeline = await Pipeline.create(createConfig());
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
            });
      
            expect(result).toBeDefined();
            expect(result.outputPath).toBeDefined();
            expect(result.processingTime).toBeGreaterThanOrEqual(0);
            expect(result.toolsUsed).toBeInstanceOf(Array);
        });
    
        it('should include reflection when enabled', async () => {
            const pipeline = await Pipeline.create(createConfig({ selfReflection: true }));
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
            });
      
            expect(result.reflection).toBeDefined();
            expect(result.reflection?.audioFile).toBe('/test/audio.m4a');
        });
    
        it('should include session when interactive', async () => {
            const pipeline = await Pipeline.create(createConfig({ interactive: true }));
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
            });
      
            expect(result.session).toBeDefined();
            expect(result.session?.completedAt).toBeInstanceOf(Date);
        });
    
        it('should return routing information', async () => {
            const pipeline = await Pipeline.create(createConfig());
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
            });
      
            // Should have routing info (even if default)
            expect(typeof result.routingConfidence).toBe('number');
        });
        
        it('should accept progress information in input', async () => {
            const pipeline = await Pipeline.create(createConfig());
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
                progress: { current: 3, total: 10 },
            });
      
            // Processing should complete successfully with progress info
            expect(result).toBeDefined();
            expect(result.outputPath).toBeDefined();
        });

        it('should include metadata header in output file', async () => {
            const pipeline = await Pipeline.create(createConfig());
      
            const result = await pipeline.process({
                audioFile: '/test/audio.m4a',
                creation: new Date('2026-01-11T12:00:00'),
                hash: 'abc123def456',
            });
      
            // Read the output file and verify it contains metadata in YAML frontmatter format
            const outputContent = await fs.readFile(result.outputPath, 'utf-8');
            
            // Should use YAML frontmatter format (new format)
            expect(outputContent).toMatch(/^---\n/); // Starts with frontmatter delimiter
            expect(outputContent).toContain('date:');
            
            // Should have routing info in frontmatter
            expect(outputContent).toContain('routing:');
            expect(outputContent).toContain('destination:');
            expect(outputContent).toContain('confidence:');
            
            // Should have the actual transcript content after the frontmatter
            // The content comes from the mocked transcription service
            expect(outputContent).toContain('test transcription');
        });
    });
  
    describe('DEFAULT_PIPELINE_CONFIG', () => {
        it('should have sensible defaults', () => {
            expect(Pipeline.DEFAULT_PIPELINE_CONFIG.model).toBe('gpt-5.2');
            expect(Pipeline.DEFAULT_PIPELINE_CONFIG.transcriptionModel).toBe('whisper-1');
            expect(Pipeline.DEFAULT_PIPELINE_CONFIG.interactive).toBe(false);
            expect(Pipeline.DEFAULT_PIPELINE_CONFIG.selfReflection).toBe(true);
        });
    });
});
