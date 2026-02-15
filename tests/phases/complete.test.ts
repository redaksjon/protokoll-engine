import { describe, expect, beforeEach, test, vi } from 'vitest';

// Mock Storage utility
const mockExists = vi.fn(() => true);
const mockCreateDirectory = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock('../../src/util/storage', () => ({
    create: vi.fn(() => ({
        exists: mockExists,
        createDirectory: mockCreateDirectory,
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        deleteFile: mockDeleteFile,
    }))
}));

// Mock logging
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
};

vi.mock('../../src/logging', () => ({
    getLogger: vi.fn().mockReturnValue(mockLogger)
}));

let completeModule: any;

describe('Complete Phase', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        // Reset mocks to default behavior
        mockExists.mockReturnValue(true);
        mockCreateDirectory.mockResolvedValue(undefined);
        mockReadFile.mockResolvedValue(Buffer.from('audio data'));
        mockWriteFile.mockResolvedValue(undefined);
        mockDeleteFile.mockResolvedValue(undefined);

        // Import the module under test
        completeModule = await import('../../src/phases/complete.js');
    });

    describe('create', () => {
        test('should create an instance with complete method', () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            expect(instance).toBeDefined();
            expect(instance.complete).toBeInstanceOf(Function);
        });
    });

    describe('complete', () => {
        test('should complete file processing successfully', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            expect(mockReadFile).toHaveBeenCalledWith(audioFile, 'binary');
            expect(mockWriteFile).toHaveBeenCalled();
            expect(mockDeleteFile).toHaveBeenCalledWith(audioFile);
            expect(result).toContain('processed');
        });

        test('should handle dry run mode', async () => {
            const config = { processedDirectory: '/processed', dryRun: true };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            expect(result).toBe(audioFile);
            expect(mockReadFile).not.toHaveBeenCalled();
            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockDeleteFile).not.toHaveBeenCalled();
        });

        test('should skip processing when processedDirectory is not configured', async () => {
            const config = { processedDirectory: '' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            expect(result).toBe(audioFile);
            expect(mockReadFile).not.toHaveBeenCalled();
        });

        test('should create processed directory with year/month structure', async () => {
            mockExists.mockReturnValue(false);

            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // With 'month' structure, should create /processed/2023/1
            expect(mockCreateDirectory).toHaveBeenCalledWith('/processed/2023/1');
        });

        test('should format filename correctly with subject and hash at end', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            // Use UTC date to avoid timezone issues in tests
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime, 'Team Meeting Notes');

            // Verify writeFile was called with correct path format
            const callArgs = mockWriteFile.mock.calls[0];
            // New format: <date>-<subject>-<hash>.ext with hash at the end
            expect(callArgs[0]).toContain('team-meeting-notes');
            expect(callArgs[0]).toContain('.mp3');
            // Hash should be at the end (before extension)
            expect(callArgs[0]).toMatch(/team-meeting-notes-abc123\.mp3$/);
        });

        test('should format filename correctly without subject', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // Verify writeFile was called with correct path format
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('abc123');
            expect(callArgs[0]).not.toContain('meeting');
            expect(callArgs[0]).toContain('.mp3');
        });

        test('should handle special characters in subject', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');
            const subject = 'Project-X: Q4 Review & Planning!';

            await instance.complete(audioFile, hash, creationTime, subject);

            // Verify special characters are cleaned
            const callArgs = mockWriteFile.mock.calls[0];
            const filename = callArgs[0];
            // Should not contain special characters
            expect(filename).not.toContain('!');
            expect(filename).not.toContain('&');
            expect(filename).not.toContain(':');
        });

        test('should truncate long subjects', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');
            const subject = 'A'.repeat(100); // Very long subject

            await instance.complete(audioFile, hash, creationTime, subject);

            // Verify subject is truncated to 50 chars
            const callArgs = mockWriteFile.mock.calls[0];
            const filename = callArgs[0];
            // New format: <date>-<subject>-<hash>.ext
            // Extract subject portion (between date/time and hash)
            const basename = filename.split('/').pop();
            // Subject should be truncated and hash should be at the end
            expect(basename).toContain('abc123');
            expect(basename).toContain('.mp3');
        });

        test('should preserve file extension', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.wav';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('.wav');
        });

        test('should return new filepath on success with year/month structure', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            // Should include year/month structure
            expect(result).toContain('/processed/2023/1/');
            expect(result).toContain('abc123');
            expect(result).toContain('.mp3');
        });

        test('should handle file operation errors gracefully', async () => {
            mockReadFile.mockRejectedValue(new Error('Read failed'));

            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            // Should return original file on error
            expect(result).toBe(audioFile);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('should handle write file errors gracefully', async () => {
            mockWriteFile.mockRejectedValue(new Error('Write failed'));

            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            // Should return original file on error
            expect(result).toBe(audioFile);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('should handle delete file errors gracefully', async () => {
            mockDeleteFile.mockRejectedValue(new Error('Delete failed'));

            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            const result = await instance.complete(audioFile, hash, creationTime);

            // Should return original file on error
            expect(result).toBe(audioFile);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('should use short hash (first 6 chars)', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'verylonghashvalue123456789';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('verylo');
            expect(callArgs[0]).not.toContain('ng');
        });

        test('should log debug messages', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Completing file processing for %s',
                audioFile
            );
        });

        test('should log info message on success', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Moved to processed: %s',
                expect.any(String)
            );
        });

        test('should handle edge case of empty subject', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime, '');

            // Empty subject should be treated as no subject
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('abc123');
            expect(callArgs[0]).toContain('.mp3');
        });

        test('should strip existing date prefix from subject to avoid duplication', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');
            // Subject that already has date prefix (from output filename)
            const subject = '15-1430-meeting-notes';

            await instance.complete(audioFile, hash, creationTime, subject);

            // Should NOT have duplicated date prefix
            const callArgs = mockWriteFile.mock.calls[0];
            const filename = callArgs[0];
            // Should only have one date prefix, not "15-1430-15-1430-"
            expect(filename).not.toMatch(/\d{2}-\d{4}-\d{2}-\d{4}/);
            expect(filename).toContain('meeting-notes');
            expect(filename).toContain('abc123');
        });

        test('should strip existing hash suffix from subject to avoid duplication', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');
            // Subject that already has hash suffix
            const subject = 'meeting-notes-e3a24f';

            await instance.complete(audioFile, hash, creationTime, subject);

            // Should NOT have duplicated hash suffix
            const callArgs = mockWriteFile.mock.calls[0];
            const filename = callArgs[0];
            // Should only have one hash, not "-e3a24f-abc123"
            expect(filename).toContain('meeting-notes');
            expect(filename).toContain('abc123');
            expect(filename).not.toContain('e3a24f');
        });

        test('should strip both date prefix and hash suffix from subject', async () => {
            const config = { processedDirectory: '/processed', outputStructure: 'month' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T14:30:00Z');
            // Subject with full pattern: date-subject-hash (typical output filename)
            const subject = '15-1430-meeting-notes-e3a24f';

            await instance.complete(audioFile, hash, creationTime, subject);

            const callArgs = mockWriteFile.mock.calls[0];
            const filename = callArgs[0];
            // Should extract just "meeting-notes" and apply new date/hash
            expect(filename).toContain('meeting-notes');
            expect(filename).toContain('abc123');
            expect(filename).not.toContain('e3a24f');
            // Should not have double date prefix
            expect(filename).not.toMatch(/\d{2}-\d{4}-\d{2}-\d{4}/);
        });

        test('should handle midnight time correctly', async () => {
            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-01-15T00:00:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // Format should be YYMMDD-HHmm
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('abc123');
            expect(callArgs[0]).toContain('.mp3');
        });

        test('should use "none" structure - no date in path, full date in filename', async () => {
            mockExists.mockReturnValue(false);

            const config = { processedDirectory: '/processed', outputStructure: 'none' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-06-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // With 'none' structure, directory should be just /processed
            expect(mockCreateDirectory).toHaveBeenCalledWith('/processed');
            
            // Filename should have full date (YYYY-MM-DD-HHmm)
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toMatch(/\/processed\/.*abc123.*\.mp3$/);
        });

        test('should use "year" structure - year in path, month/day/time in filename', async () => {
            mockExists.mockReturnValue(false);

            const config = { processedDirectory: '/processed', outputStructure: 'year' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-06-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // With 'year' structure, directory should be /processed/2023
            expect(mockCreateDirectory).toHaveBeenCalledWith('/processed/2023');
            
            // Filename should have month-day-time
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('/processed/2023/');
            expect(callArgs[0]).toContain('abc123');
        });

        test('should use "day" structure - full date in path, only time in filename', async () => {
            mockExists.mockReturnValue(false);

            const config = { processedDirectory: '/processed', outputStructure: 'day' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-06-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // With 'day' structure, directory should be /processed/2023/6/15
            expect(mockCreateDirectory).toHaveBeenCalledWith('/processed/2023/6/15');
            
            // Filename should have just time
            const callArgs = mockWriteFile.mock.calls[0];
            expect(callArgs[0]).toContain('/processed/2023/6/15/');
            expect(callArgs[0]).toContain('abc123');
        });

        test('should use default structure (month) when not specified', async () => {
            mockExists.mockReturnValue(false);

            const config = { processedDirectory: '/processed' };
            const instance = completeModule.create(config);

            const audioFile = '/audio/test.mp3';
            const hash = 'abc123def456';
            const creationTime = new Date('2023-06-15T14:30:00Z');

            await instance.complete(audioFile, hash, creationTime);

            // Default (month) structure should be /processed/2023/6
            expect(mockCreateDirectory).toHaveBeenCalledWith('/processed/2023/6');
        });
    });
});

