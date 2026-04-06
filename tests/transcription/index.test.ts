/**
 * Tests for Transcription System Factory (transcription/index.ts)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the service module
vi.mock('../../src/transcription/service', () => ({
    create: vi.fn(() => ({
        transcribe: vi.fn().mockResolvedValue({ text: 'transcribed', model: 'whisper-1', duration: 50 }),
        supportsStreaming: vi.fn((m: string) => m !== 'whisper-1'),
        supportsDiarization: vi.fn((m: string) => m === 'gpt-4o-transcribe-diarize'),
    })),
}));

describe('Transcription System Factory', () => {
    it('should create a transcription instance with default model', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create();
        expect(instance).toBeDefined();
        expect(typeof instance.transcribe).toBe('function');
        expect(typeof instance.supportsStreaming).toBe('function');
        expect(typeof instance.supportsDiarization).toBe('function');
        expect(typeof instance.setDefaultModel).toBe('function');
        expect(typeof instance.getDefaultModel).toBe('function');
        expect(instance.getDefaultModel()).toBe('whisper-1');
    });

    it('should create with custom default model', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create({ defaultModel: 'gpt-4o-transcribe' });
        expect(instance.getDefaultModel()).toBe('gpt-4o-transcribe');
    });

    it('should transcribe using default model', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create();
        const result = await instance.transcribe('/audio/test.mp3');
        expect(result.text).toBe('transcribed');
        expect(result.model).toBe('whisper-1');
    });

    it('should transcribe with custom config options', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create({ defaultModel: 'whisper-1' });
        const result = await instance.transcribe('/audio/test.mp3', {
            model: 'gpt-4o-transcribe',
            language: 'no',
        });
        expect(result.text).toBe('transcribed');
    });

    it('should delegate supportsStreaming', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create();
        expect(instance.supportsStreaming('whisper-1')).toBe(false);
        expect(instance.supportsStreaming('gpt-4o-transcribe')).toBe(true);
    });

    it('should delegate supportsDiarization', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create();
        expect(instance.supportsDiarization('gpt-4o-transcribe-diarize')).toBe(true);
        expect(instance.supportsDiarization('whisper-1')).toBe(false);
    });

    it('should set and get default model', async () => {
        const { create } = await import('../../src/transcription');
        const instance = create();
        expect(instance.getDefaultModel()).toBe('whisper-1');
        instance.setDefaultModel('gpt-4o-transcribe');
        expect(instance.getDefaultModel()).toBe('gpt-4o-transcribe');
    });
});
