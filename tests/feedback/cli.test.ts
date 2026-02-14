/**
 * Tests for Feedback CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';

// Mock logging
const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../src/logging', () => ({
    getLogger: () => mockLogger,
    setLogLevel: vi.fn(),
}));

// Mock context
const mockContext = {
    getAllProjects: vi.fn(() => []),
    getProject: vi.fn(() => null),
    saveEntity: vi.fn(),
};

vi.mock('../../src/context', () => ({
    create: vi.fn(() => Promise.resolve(mockContext)),
}));

// Mock reasoning
vi.mock('../../src/reasoning', () => ({
    create: vi.fn(() => ({
        complete: vi.fn(),
    })),
}));

// Mock readline
vi.mock('readline', () => ({
    createInterface: vi.fn(() => ({
        question: vi.fn((q, cb) => cb('n')),
        close: vi.fn(),
    })),
}));

// Mock decision tracker
const mockDecisions = [
    {
        id: 'dec-001',
        audioFile: '/test/audio1.m4a',
        projectId: 'project-a',
        confidence: 0.85,
        timestamp: new Date('2026-01-15T10:00:00Z'),
        feedbackStatus: 'correct',
    },
    {
        id: 'dec-002',
        audioFile: '/test/audio2.m4a',
        projectId: 'project-b',
        confidence: 0.72,
        timestamp: new Date('2026-01-15T11:00:00Z'),
        feedbackStatus: 'incorrect',
    },
    {
        id: 'dec-003',
        audioFile: '/test/audio3.m4a',
        projectId: null,
        confidence: 0.65,
        timestamp: new Date('2026-01-15T12:00:00Z'),
        feedbackStatus: undefined, // pending
    },
];

const mockTracker = {
    getRecentDecisions: vi.fn(() => Promise.resolve(mockDecisions)),
    getDecision: vi.fn((id: string) => Promise.resolve(mockDecisions.find(d => d.id === id) || null)),
};

vi.mock('../../src/feedback/decision-tracker', () => ({
    create: vi.fn(() => mockTracker),
}));

// Mock feedback system
const mockFeedbackSystem = {
    collectAndProcess: vi.fn(() => Promise.resolve({
        feedback: { isCorrect: true },
        appliedUpdates: [{ type: 'phrase_added' }],
    })),
};

vi.mock('../../src/feedback/index', () => ({
    create: vi.fn(() => Promise.resolve(mockFeedbackSystem)),
}));

// Import after mocking
const { createFeedbackCommand } = await import('../../src/feedback/cli');

describe('Feedback CLI', () => {
    let tempDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protokoll-cli-test-'));
        
        // Create decisions directory with a sample decision
        const decisionsDir = path.join(tempDir, 'decisions');
        await fs.mkdir(decisionsDir, { recursive: true });
        
        const sampleDecision = {
            id: 'dec-test123',
            transcriptPreview: 'Sample transcript...',
            audioFile: '/test/sample.m4a',
            projectId: 'test-project',
            destination: '~/notes/test',
            confidence: 0.85,
            timestamp: new Date().toISOString(),
            reasoningTrace: {
                signalsDetected: [],
                projectsConsidered: [],
                finalReasoning: 'Test match',
            },
        };
        
        await fs.writeFile(
            path.join(decisionsDir, 'decision-dec-test123.json'),
            JSON.stringify(sampleDecision, null, 2)
        );
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true });
    });

    describe('createFeedbackCommand', () => {
        it('should create a Commander command', () => {
            const cmd = createFeedbackCommand();

            expect(cmd).toBeInstanceOf(Command);
            expect(cmd.name()).toBe('feedback');
        });

        it('should have expected options', () => {
            const cmd = createFeedbackCommand();
            const options = cmd.options;

            const optionNames = options.map(o => o.long);
            expect(optionNames).toContain('--recent');
            expect(optionNames).toContain('--file');
            expect(optionNames).toContain('--decision');
            expect(optionNames).toContain('--learn');
            expect(optionNames).toContain('--model');
        });

        it('should have correct description', () => {
            const cmd = createFeedbackCommand();
            
            expect(cmd.description()).toContain('feedback');
            expect(cmd.description()).toContain('classification');
        });
    });

    describe('command options parsing', () => {
        it('should parse --recent option', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--recent'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.recent).toBe(true);
        });

        it('should parse --decision option with value', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--decision', 'dec-abc123'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.decision).toBe('dec-abc123');
        });

        it('should parse --model option with value', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--model', 'gpt-4o'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.model).toBe('gpt-4o');
        });

        it('should have default model', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--recent'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.model).toBe('gpt-5.2');
        });

        it('should parse verbose and debug flags', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--verbose', '--debug'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.verbose).toBe(true);
            expect(opts.debug).toBe(true);
        });

        it('should parse --config-directory option', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--config-directory', '/custom/path'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.configDirectory).toBe('/custom/path');
        });

        it('should parse --list-pending option', () => {
            const cmd = createFeedbackCommand();
            
            cmd.parse(['node', 'test', '--list-pending'], { from: 'user' });
            const opts = cmd.opts();
            
            expect(opts.listPending).toBe(true);
        });
    });

    describe('command action execution', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            vi.mocked(console.log).mockClear();
            vi.mocked(console.error).mockClear();
            vi.mocked(process.exit).mockClear();
            
            // Reset mock implementations
            mockTracker.getRecentDecisions.mockResolvedValue(mockDecisions);
            mockTracker.getDecision.mockImplementation((id: string) => 
                Promise.resolve(mockDecisions.find(d => d.id === id) || null)
            );
        });

        it('should show recent decisions with --recent flag', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--recent', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('Recent Classification Decisions');
            expect(logCalls).toContain('dec-001');
            expect(logCalls).toContain('dec-002');
            expect(logCalls).toContain('85.0%'); // confidence
            expect(logCalls).toContain('✓'); // correct status
            expect(logCalls).toContain('✗'); // incorrect status
            expect(logCalls).toContain('?'); // pending status
        });

        it('should show message when no recent decisions exist', async () => {
            mockTracker.getRecentDecisions.mockResolvedValue([]);
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--recent', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('No recent classification decisions found');
        });

        it('should handle --decision with valid ID', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--decision', 'dec-001', '--config-directory', tempDir], { from: 'user' });

            expect(mockFeedbackSystem.collectAndProcess).toHaveBeenCalled();
            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('updates applied');
        });

        it('should exit with error for --decision with invalid ID', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--decision', 'nonexistent', '--config-directory', tempDir], { from: 'user' });

            expect(mockLogger.error).toHaveBeenCalledWith('Decision not found: %s', 'nonexistent');
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should show not-implemented message for --file option', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--file', '/test/file.md', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('Not yet implemented');
            expect(logCalls).toContain('/test/file.md');
        });

        it('should list pending decisions with --list-pending', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--list-pending', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('pending feedback');
            expect(logCalls).toContain('dec-003'); // The one without feedbackStatus
        });

        it('should show help when no options provided', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('Feedback System Help');
            expect(logCalls).toContain('--recent');
            expect(logCalls).toContain('--decision');
        });

        it('should set verbose log level with --verbose', async () => {
            const { setLogLevel } = await import('../../src/logging');
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--verbose', '--config-directory', tempDir], { from: 'user' });

            expect(setLogLevel).toHaveBeenCalledWith('verbose');
        });

        it('should set debug log level with --debug', async () => {
            const { setLogLevel } = await import('../../src/logging');
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--debug', '--config-directory', tempDir], { from: 'user' });

            expect(setLogLevel).toHaveBeenCalledWith('debug');
        });

        it('should handle decision with no applied updates', async () => {
            mockFeedbackSystem.collectAndProcess.mockResolvedValue({
                feedback: { isCorrect: true },
                appliedUpdates: [],
            });
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--decision', 'dec-001', '--config-directory', tempDir], { from: 'user' });

            expect(mockLogger.info).toHaveBeenCalledWith('Feedback processed successfully');
            // Should not print updates message
            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).not.toContain('updates applied');
        });

        it('should handle decision with null feedback result', async () => {
            mockFeedbackSystem.collectAndProcess.mockResolvedValue({
                feedback: null,
                appliedUpdates: null,
            });
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--decision', 'dec-001', '--config-directory', tempDir], { from: 'user' });

            // Should not crash or log success
            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        it('should handle context creation errors', async () => {
            const Context = await import('../../src/context');
            vi.mocked(Context.create).mockRejectedValueOnce(new Error('Config not found'));
            
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--recent', '--config-directory', tempDir], { from: 'user' });

            expect(mockLogger.error).toHaveBeenCalledWith('Feedback command failed', expect.any(Object));
            expect(process.exit).toHaveBeenCalledWith(1);
        });

        it('should show (default) for decisions without projectId', async () => {
            const cmd = createFeedbackCommand();
            await cmd.parseAsync(['node', 'test', '--recent', '--config-directory', tempDir], { from: 'user' });

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('(default)'); // dec-003 has null projectId
        });
    });
});
