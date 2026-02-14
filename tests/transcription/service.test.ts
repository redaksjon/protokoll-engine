import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MODEL_CAPABILITIES, TranscriptionModel } from '../../src/transcription/types';

// Test the model capabilities directly without needing OpenAI client
describe('Transcription Model Capabilities', () => {
    describe('Streaming Support', () => {
        it('should indicate whisper-1 does not support streaming', () => {
            expect(MODEL_CAPABILITIES['whisper-1'].supportsStreaming).toBe(false);
        });
    
        it('should indicate gpt-4o-transcribe supports streaming', () => {
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe'].supportsStreaming).toBe(true);
        });
    
        it('should indicate gpt-4o-mini-transcribe supports streaming', () => {
            expect(MODEL_CAPABILITIES['gpt-4o-mini-transcribe'].supportsStreaming).toBe(true);
        });
    
        it('should indicate gpt-4o-transcribe-diarize supports streaming', () => {
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe-diarize'].supportsStreaming).toBe(true);
        });
    });
  
    describe('Diarization Support', () => {
        it('should indicate only gpt-4o-transcribe-diarize supports diarization', () => {
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe-diarize'].supportsDiarization).toBe(true);
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe'].supportsDiarization).toBe(false);
            expect(MODEL_CAPABILITIES['gpt-4o-mini-transcribe'].supportsDiarization).toBe(false);
            expect(MODEL_CAPABILITIES['whisper-1'].supportsDiarization).toBe(false);
        });
    });
  
    describe('Max File Size', () => {
        it('should have correct max file size for all models', () => {
            const expectedSize = 25 * 1024 * 1024; // 25 MB
      
            expect(MODEL_CAPABILITIES['whisper-1'].maxFileSize).toBe(expectedSize);
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe'].maxFileSize).toBe(expectedSize);
            expect(MODEL_CAPABILITIES['gpt-4o-mini-transcribe'].maxFileSize).toBe(expectedSize);
            expect(MODEL_CAPABILITIES['gpt-4o-transcribe-diarize'].maxFileSize).toBe(expectedSize);
        });
    });
  
    describe('Model Completeness', () => {
        it('should define capabilities for all known models', () => {
            const expectedModels: TranscriptionModel[] = [
                'whisper-1',
                'gpt-4o-transcribe',
                'gpt-4o-mini-transcribe',
                'gpt-4o-transcribe-diarize',
            ];
      
            for (const model of expectedModels) {
                expect(MODEL_CAPABILITIES[model]).toBeDefined();
                expect(MODEL_CAPABILITIES[model].supportsStreaming).toBeDefined();
                expect(MODEL_CAPABILITIES[model].supportsDiarization).toBeDefined();
                expect(MODEL_CAPABILITIES[model].maxFileSize).toBeDefined();
            }
        });
    });
});

// Test the service factory with mocked OpenAI - use unstable_mockModule for ESM
describe('Transcription Service Factory', () => {
    it('should export create function', async () => {
        const Transcription = await import('../../src/transcription');
        expect(Transcription.create).toBeDefined();
        expect(typeof Transcription.create).toBe('function');
    });
  
    it('should export types', async () => {
        const Types = await import('../../src/transcription/types');
        expect(Types.MODEL_CAPABILITIES).toBeDefined();
    });
});
