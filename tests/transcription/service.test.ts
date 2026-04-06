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

// ============================================================================
// Tests for the create() factory in service.ts
// ============================================================================

// Mock OpenAI
const mockTranscriptionCreate = vi.fn();
const mockOpenAI = {
    audio: {
        transcriptions: {
            create: mockTranscriptionCreate,
        },
    },
};

vi.mock('openai', () => ({
    default: vi.fn(() => mockOpenAI),
}));

// Mock storage
const mockStorage = {
    exists: vi.fn(),
    createDirectory: vi.fn(),
    readStream: vi.fn(),
    deleteFile: vi.fn(),
    deleteDirectory: vi.fn(),
};

vi.mock('../../src/util/storage', () => ({
    create: vi.fn(() => mockStorage),
}));

// Mock media
const mockMedia = {
    getFileSize: vi.fn(),
    convertToSupportedFormat: vi.fn(),
    splitAudioFile: vi.fn(),
};

vi.mock('../../src/util/media', () => ({
    create: vi.fn(() => mockMedia),
}));

// Mock logging
vi.mock('../../src/logging', () => ({
    getLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Import the service factory
const { create: createService } = await import('../../src/transcription/service');

describe('Transcription Service', () => {
    let service: ReturnType<typeof createService>;

    beforeEach(() => {
        vi.clearAllMocks();
        service = createService(mockOpenAI as any);
    });

    describe('supportsStreaming', () => {
        it('should return false for whisper-1', () => {
            expect(service.supportsStreaming('whisper-1')).toBe(false);
        });

        it('should return true for gpt-4o-transcribe', () => {
            expect(service.supportsStreaming('gpt-4o-transcribe')).toBe(true);
        });

        it('should return true for gpt-4o-mini-transcribe', () => {
            expect(service.supportsStreaming('gpt-4o-mini-transcribe')).toBe(true);
        });

        it('should return true for gpt-4o-transcribe-diarize', () => {
            expect(service.supportsStreaming('gpt-4o-transcribe-diarize')).toBe(true);
        });
    });

    describe('supportsDiarization', () => {
        it('should return false for whisper-1', () => {
            expect(service.supportsDiarization('whisper-1')).toBe(false);
        });

        it('should return false for gpt-4o-transcribe', () => {
            expect(service.supportsDiarization('gpt-4o-transcribe')).toBe(false);
        });

        it('should return false for gpt-4o-mini-transcribe', () => {
            expect(service.supportsDiarization('gpt-4o-mini-transcribe')).toBe(false);
        });

        it('should return true for gpt-4o-transcribe-diarize', () => {
            expect(service.supportsDiarization('gpt-4o-transcribe-diarize')).toBe(true);
        });
    });

    describe('transcribe', () => {
        const normalFileSize = 10 * 1024 * 1024; // 10MB - under limit
        const largeFileSize = 30 * 1024 * 1024; // 30MB - over limit
        const nearLimitSize = 25 * 1024 * 1024; // 25MB - at limit (95% threshold = 24.9MB)

        it('should transcribe a normal-sized file', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(normalFileSize)   // original file size
                .mockResolvedValueOnce(normalFileSize);  // converted file size
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/test.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Hello world' });

            const result = await service.transcribe({
                audioFile: '/audio/test.mp3',
                config: { model: 'whisper-1' },
            });

            expect(result.text).toBe('Hello world');
            expect(result.model).toBe('whisper-1');
            expect(result.duration).toBeGreaterThanOrEqual(0);
            expect(mockMedia.convertToSupportedFormat).toHaveBeenCalledWith(
                '/audio/test.mp3',
                expect.stringContaining('protokoll-conversions')
            );
            expect(mockTranscriptionCreate).toHaveBeenCalledTimes(1);
        });

        it('should transcribe with optional config parameters', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(normalFileSize)
                .mockResolvedValueOnce(normalFileSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/test.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Result' });

            await service.transcribe({
                audioFile: '/audio/test.mp3',
                config: {
                    model: 'gpt-4o-transcribe',
                    language: 'no',
                    temperature: 0.2,
                    prompt: 'Meeting notes',
                    response_format: 'verbose_json',
                },
            });

            expect(mockTranscriptionCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o-transcribe',
                    language: 'no',
                    temperature: 0.2,
                    prompt: 'Meeting notes',
                    response_format: 'verbose_json',
                })
            );
        });

        it('should split large file and transcribe chunks', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(largeFileSize)    // original
                .mockResolvedValueOnce(largeFileSize);   // after conversion still large
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/big.mp3');
            mockStorage.createDirectory.mockResolvedValue(undefined);
            mockStorage.readStream.mockResolvedValue({} as any);
            mockStorage.deleteFile.mockResolvedValue(undefined);
            mockStorage.deleteDirectory.mockResolvedValue(undefined);
            mockMedia.splitAudioFile.mockResolvedValue(['/tmp/chunk1.mp3', '/tmp/chunk2.mp3']);
            mockTranscriptionCreate
                .mockResolvedValueOnce({ text: 'Part 1' })
                .mockResolvedValueOnce({ text: 'Part 2' });

            const result = await service.transcribe({
                audioFile: '/audio/big.mp3',
                config: { model: 'whisper-1' },
            });

            expect(result.text).toBe('Part 1 Part 2');
            expect(mockMedia.splitAudioFile).toHaveBeenCalledWith(
                '/audio/big.mp3',
                expect.stringContaining('split_audio_'),
                26214400
            );
            expect(mockTranscriptionCreate).toHaveBeenCalledTimes(2);
            // Should clean up chunks
            expect(mockStorage.deleteFile).toHaveBeenCalledTimes(2);
            expect(mockStorage.deleteDirectory).toHaveBeenCalledTimes(1);
        });

        it('should force conversion when file is near size limit', async () => {
            // 95% of 25MB = ~24.9MB, so a 25MB file triggers force conversion
            mockMedia.getFileSize
                .mockResolvedValueOnce(nearLimitSize)    // original - triggers force
                .mockResolvedValueOnce(normalFileSize);  // after conversion - smaller
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/converted.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Converted result' });

            const result = await service.transcribe({
                audioFile: '/audio/test.wav',
                config: { model: 'whisper-1' },
            });

            expect(result.text).toBe('Converted result');
            // Should have called with forceConversion = true
            expect(mockMedia.convertToSupportedFormat).toHaveBeenCalledWith(
                '/audio/test.wav',
                expect.stringContaining('protokoll-conversions'),
                true
            );
        });

        it('should not force conversion when file is well under limit', async () => {
            const smallSize = 5 * 1024 * 1024; // 5MB
            mockMedia.getFileSize
                .mockResolvedValueOnce(smallSize)
                .mockResolvedValueOnce(smallSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/test.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Small file result' });

            await service.transcribe({
                audioFile: '/audio/test.mp3',
                config: { model: 'whisper-1' },
            });

            expect(mockMedia.convertToSupportedFormat).toHaveBeenCalledWith(
                '/audio/test.mp3',
                expect.stringContaining('protokoll-conversions')
            );
        });

        it('should handle chunk deletion errors gracefully', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(largeFileSize)
                .mockResolvedValueOnce(largeFileSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/big.mp3');
            mockStorage.createDirectory.mockResolvedValue(undefined);
            mockStorage.readStream.mockResolvedValue({} as any);
            mockStorage.deleteFile.mockRejectedValue(new Error('delete failed'));
            mockStorage.deleteDirectory.mockRejectedValue(new Error('dir delete failed'));
            mockMedia.splitAudioFile.mockResolvedValue(['/tmp/chunk1.mp3']);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Part 1' });

            const result = await service.transcribe({
                audioFile: '/audio/big.mp3',
                config: { model: 'whisper-1' },
            });

            // Should still return the transcription even if cleanup fails
            expect(result.text).toBe('Part 1');
        });

        it('should throw on split processing error', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(largeFileSize)
                .mockResolvedValueOnce(largeFileSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/big.mp3');
            mockStorage.createDirectory.mockResolvedValue(undefined);
            mockMedia.splitAudioFile.mockRejectedValue(new Error('split failed'));

            await expect(
                service.transcribe({
                    audioFile: '/audio/big.mp3',
                    config: { model: 'whisper-1' },
                })
            ).rejects.toThrow(/Failed to process split audio files/);
        });

        it('should use default response_format when not specified', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(normalFileSize)
                .mockResolvedValueOnce(normalFileSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/test.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Result' });

            await service.transcribe({
                audioFile: '/audio/test.mp3',
                config: { model: 'whisper-1' },
            });

            expect(mockTranscriptionCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    response_format: 'json',
                })
            );
        });

        it('should not include optional params when not set', async () => {
            mockMedia.getFileSize
                .mockResolvedValueOnce(normalFileSize)
                .mockResolvedValueOnce(normalFileSize);
            mockMedia.convertToSupportedFormat.mockResolvedValue('/audio/test.mp3');
            mockStorage.readStream.mockResolvedValue({} as any);
            mockTranscriptionCreate.mockResolvedValue({ text: 'Result' });

            await service.transcribe({
                audioFile: '/audio/test.mp3',
                config: { model: 'whisper-1' },
            });

            const callArgs = mockTranscriptionCreate.mock.calls[0][0];
            expect(callArgs.language).toBeUndefined();
            expect(callArgs.temperature).toBeUndefined();
            expect(callArgs.prompt).toBeUndefined();
        });
    });
});
