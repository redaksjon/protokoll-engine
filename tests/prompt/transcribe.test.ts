/**
 * Tests for prompt/transcribe module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createTranscribePrompt, create } from '../../src/prompt/transcribe';
import type { Config } from '../../src/protokoll';

describe('prompt/transcribe', () => {
    let tempDir: string;
    let configDir: string;
    
    const testConfig: Config = {
        configDirectory: '',  // Will be set in beforeEach
        debug: false,
        verbose: false,
        model: 'gpt-4',
        transcriptionModel: 'whisper-1',
        reasoningLevel: 'medium',
        interactive: false,
        selfReflection: false,
        silent: true,
        dryRun: false,
        maxAudioSize: 25000000,
        tempDirectory: os.tmpdir(),
    };

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-test-'));
        configDir = path.join(tempDir, '.protokoll');
        await fs.mkdir(configDir, { recursive: true });
        testConfig.configDirectory = configDir;
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('createTranscribePrompt', () => {
        it('should create a prompt with transcription text', async () => {
            const transcriptionText = 'This is a test transcription.';
            const prompt = await createTranscribePrompt(transcriptionText, testConfig);

            // Prompt should be defined and be an object
            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe('object');
        });

        it('should create prompts with different transcription texts', async () => {
            const prompt1 = await createTranscribePrompt('First transcription', testConfig);
            const prompt2 = await createTranscribePrompt('Second transcription', testConfig);

            // Both should be valid prompts
            expect(prompt1).toBeDefined();
            expect(prompt2).toBeDefined();
        });
    });

    describe('create (factory)', () => {
        it('should create a factory with createTranscribePrompt method', () => {
            const mockModel = { chat: vi.fn() };
            const factory = create(mockModel as any, testConfig);

            expect(factory).toBeDefined();
            expect(typeof factory.createTranscribePrompt).toBe('function');
        });

        it('should create prompts via factory method', async () => {
            const mockModel = { chat: vi.fn() };
            const factory = create(mockModel as any, testConfig);

            const transcriptionText = 'Test transcription from factory.';
            const prompt = await factory.createTranscribePrompt(transcriptionText);

            // Prompt should be defined
            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe('object');
        });
    });
});
