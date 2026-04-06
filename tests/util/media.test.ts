/**
 * Tests for Media Utility
 * 
 * Tests the ffmpeg wrapper with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fluent-ffmpeg at module level
const mockFfprobe = vi.fn();
const mockFfmpegInstance = {
    setStartTime: vi.fn().mockReturnThis(),
    setDuration: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    audioBitrate: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    run: vi.fn(),
};

vi.mock('fluent-ffmpeg', () => ({
    default: {
        ffprobe: mockFfprobe,
    },
    // The function call ffmpeg(filePath) returns an instance
}));

// We need to handle the default export as a callable function
vi.mock('fluent-ffmpeg', () => {
    const factory = (filePath?: string) => {
        // Reset mocks for each call
        mockFfmpegInstance.setStartTime.mockReturnThis();
        mockFfmpegInstance.setDuration.mockReturnThis();
        mockFfmpegInstance.output.mockReturnThis();
        mockFfmpegInstance.toFormat.mockReturnThis();
        mockFfmpegInstance.audioBitrate.mockReturnThis();
        mockFfmpegInstance.on.mockReturnThis();
        return mockFfmpegInstance;
    };
    factory.ffprobe = mockFfprobe;
    return { default: factory };
});

// Mock storage
const mockStorage = {
    exists: vi.fn(),
    createDirectory: vi.fn(),
    getFileSize: vi.fn(),
};

vi.mock('../../src/util/storage', () => ({
    create: vi.fn(() => mockStorage),
}));

// Import after mocking
const { create } = await import('../../src/util/media');

describe('Media Utility', () => {
    let media: ReturnType<typeof create>;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        media = create(mockLogger);
    });

    describe('getAudioCreationTime', () => {
        it('should return date from format tags creation_time', async () => {
            const testDate = '2024-01-15T10:30:00.000Z';
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, {
                    format: {
                        tags: { creation_time: testDate },
                    },
                    streams: [],
                });
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeInstanceOf(Date);
            expect(result?.toISOString()).toContain('2024-01-15');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('format tags'),
                testDate
            );
        });

        it('should return date from stream tags as fallback', async () => {
            const testDate = '2024-03-20T14:00:00.000Z';
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, {
                    format: { tags: {} },
                    streams: [{ tags: { creation_time: testDate } }],
                });
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeInstanceOf(Date);
            expect(result?.toISOString()).toContain('2024-03-20');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('stream tags'),
                testDate
            );
        });

        it('should return null when no creation_time found', async () => {
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, {
                    format: { tags: {} },
                    streams: [],
                });
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeNull();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('No creation_time')
            );
        });

        it('should return null when metadata is null/undefined', async () => {
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, null);
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeNull();
        });

        it('should return null on ffprobe error', async () => {
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(new Error('ffprobe failed'), null);
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error extracting creation time'),
                expect.any(Error)
            );
        });

        it('should check multiple streams for creation_time', async () => {
            const testDate = '2024-06-01T00:00:00.000Z';
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, {
                    format: { tags: {} },
                    streams: [
                        { tags: {} },
                        { tags: { creation_time: testDate } },
                    ],
                });
            });

            const result = await media.getAudioCreationTime('/audio/test.mp3');
            expect(result).toBeInstanceOf(Date);
            expect(result?.toISOString()).toContain('2024-06-01');
        });
    });

    describe('getFileSize', () => {
        it('should delegate to storage.getFileSize', async () => {
            mockStorage.getFileSize.mockResolvedValue(1024);
            const size = await media.getFileSize('/audio/test.mp3');
            expect(size).toBe(1024);
            expect(mockStorage.getFileSize).toHaveBeenCalledWith('/audio/test.mp3');
        });

        it('should wrap errors with descriptive message', async () => {
            mockStorage.getFileSize.mockRejectedValue(new Error('disk error'));
            await expect(media.getFileSize('/audio/test.mp3')).rejects.toThrow(
                /Failed to get file size for \/audio\/test.mp3/
            );
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error getting file size'),
                expect.any(Error)
            );
        });
    });

    describe('splitAudioFile', () => {
        it('should split file into segments based on size', async () => {
            const fileSize = 30 * 1024 * 1024; // 30MB
            const maxSize = 25 * 1024 * 1024; // 25MB

            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(null, {
                    format: { duration: '120' }, // 2 minutes
                    streams: [],
                });
            });
            mockStorage.getFileSize.mockResolvedValue(fileSize);
            mockStorage.createDirectory.mockResolvedValue(undefined);

            // Mock ffmpeg run to resolve immediately
            mockFfmpegInstance.run.mockImplementation(function (this: any) {
                // Find the 'end' handler from on() calls
                const onCalls = mockFfmpegInstance.on.mock.calls;
                for (const [event, handler] of onCalls) {
                    if (event === 'end') handler();
                }
            });

            const result = await media.splitAudioFile('/audio/big.mp3', '/tmp/split', maxSize);
            // 30MB / 25MB = ceil(1.2) = 2 segments
            expect(result).toHaveLength(2);
            expect(result[0]).toContain('_part1');
            expect(result[1]).toContain('_part2');
            expect(mockStorage.createDirectory).toHaveBeenCalledWith('/tmp/split');
        });

        it('should throw with descriptive message on error', async () => {
            mockFfprobe.mockImplementation((path: string, cb: any) => {
                cb(new Error('ffprobe error'), null);
            });

            await expect(
                media.splitAudioFile('/audio/big.mp3', '/tmp/split', 25 * 1024 * 1024)
            ).rejects.toThrow(/Failed to split audio file/);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('convertToSupportedFormat', () => {
        it('should return original path for supported format (mp3)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.mp3', '/tmp/out');
            expect(result).toBe('/audio/test.mp3');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('already in a supported format')
            );
        });

        it('should return original path for supported format (wav)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.wav', '/tmp/out');
            expect(result).toBe('/audio/test.wav');
        });

        it('should return original path for supported format (flac)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.flac', '/tmp/out');
            expect(result).toBe('/audio/test.flac');
        });

        it('should return original path for supported format (m4a)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.m4a', '/tmp/out');
            expect(result).toBe('/audio/test.m4a');
        });

        it('should return original path for supported format (ogg)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.ogg', '/tmp/out');
            expect(result).toBe('/audio/test.ogg');
        });

        it('should return original path for supported format (webm)', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.webm', '/tmp/out');
            expect(result).toBe('/audio/test.webm');
        });

        it('should return original path for MP3 even with forceConversion', async () => {
            const result = await media.convertToSupportedFormat('/audio/test.mp3', '/tmp/out', true);
            expect(result).toBe('/audio/test.mp3');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('already MP3')
            );
        });

        it('should convert unsupported format to mp3', async () => {
            mockStorage.exists.mockResolvedValue(false);
            mockStorage.createDirectory.mockResolvedValue(undefined);

            // Mock ffmpeg run to resolve
            mockFfmpegInstance.run.mockImplementation(function (this: any) {
                const onCalls = mockFfmpegInstance.on.mock.calls;
                for (const [event, handler] of onCalls) {
                    if (event === 'end') handler();
                }
            });

            const result = await media.convertToSupportedFormat('/audio/test.wma', '/tmp/out');
            expect(result).toBe('/tmp/out/test.mp3');
            expect(mockFfmpegInstance.toFormat).toHaveBeenCalledWith('mp3');
            expect(mockFfmpegInstance.audioBitrate).toHaveBeenCalledWith('128k');
            expect(mockStorage.createDirectory).toHaveBeenCalledWith('/tmp/out');
        });

        it('should return existing converted file if already exists', async () => {
            mockStorage.exists.mockResolvedValue(true);

            const result = await media.convertToSupportedFormat('/audio/test.wma', '/tmp/out');
            expect(result).toBe('/tmp/out/test.mp3');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Converted file already exists')
            );
            // Should not call ffmpeg
            expect(mockFfmpegInstance.run).not.toHaveBeenCalled();
        });

        it('should force convert supported non-MP3 format', async () => {
            mockStorage.exists.mockResolvedValue(false);
            mockStorage.createDirectory.mockResolvedValue(undefined);

            mockFfmpegInstance.run.mockImplementation(function (this: any) {
                const onCalls = mockFfmpegInstance.on.mock.calls;
                for (const [event, handler] of onCalls) {
                    if (event === 'end') handler();
                }
            });

            const result = await media.convertToSupportedFormat('/audio/test.wav', '/tmp/out', true);
            expect(result).toBe('/tmp/out/test.mp3');
            expect(mockFfmpegInstance.toFormat).toHaveBeenCalledWith('mp3');
        });

        it('should handle ffmpeg conversion error', async () => {
            mockStorage.exists.mockResolvedValue(false);
            mockStorage.createDirectory.mockResolvedValue(undefined);

            mockFfmpegInstance.run.mockImplementation(function (this: any) {
                const onCalls = mockFfmpegInstance.on.mock.calls;
                for (const [event, handler] of onCalls) {
                    if (event === 'error') handler(new Error('conversion failed'));
                }
            });

            await expect(
                media.convertToSupportedFormat('/audio/test.wma', '/tmp/out')
            ).rejects.toThrow(/Failed to convert/);
        });

        it('should handle unexpected errors', async () => {
            // Force an error by making path.extname throw (it won't, but let's test the catch)
            // Instead, let's test with a format that triggers conversion but storage.createDirectory fails
            mockStorage.exists.mockResolvedValue(false);
            mockStorage.createDirectory.mockRejectedValue(new Error('permission denied'));

            await expect(
                media.convertToSupportedFormat('/audio/test.wma', '/tmp/out')
            ).rejects.toThrow(/Failed to convert audio file/);
        });
    });
});
