import { describe, expect, test, beforeEach, vi } from 'vitest';
import { FilesystemStructure } from '@utilarium/dreadcabinet';
import { FilenameOption } from '@utilarium/dreadcabinet';

// Setup mock functions that will be used inside mock modules
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
};

const mockGetAudioCreationTime = vi.fn();
const mockHashFile = vi.fn();
const mockNow = vi.fn();
const mockConstructOutputDirectory = vi.fn();
const mockConstructFilename = vi.fn();

// Mock fs and crypto before importing anything that might use them
vi.mock('fs', () => ({
    promises: {
        readFile: vi.fn(),
        stat: vi.fn(),
        access: vi.fn()
    }
}));

vi.mock('crypto', () => ({
    createHash: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue('12345678abcdef')
    }))
}));

// Mock modules before importing the code under test
vi.mock('@/logging', () => ({
    getLogger: vi.fn(() => mockLogger)
}));

vi.mock('@/util/media', () => ({
    create: vi.fn(() => ({
        getAudioCreationTime: mockGetAudioCreationTime
    }))
}));

const mockExists = vi.fn();
const mockCreateDirectory = vi.fn();

vi.mock('@/util/storage', () => ({
    create: vi.fn(() => ({
        hashFile: mockHashFile,
        exists: mockExists,
        createDirectory: mockCreateDirectory,
    }))
}));

vi.mock('@/util/dates', () => ({
    create: vi.fn(() => ({
        now: mockNow
    }))
}));

// Now import the module under test
// @ts-ignore
const LocatePhase = await import('@/phases/locate');

describe('locate', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Set up common mock behaviors
        // @ts-ignore
        mockGetAudioCreationTime.mockResolvedValue(new Date('2023-01-01T12:00:00Z'));
        // @ts-ignore
        mockHashFile.mockResolvedValue('12345678abcdef');
        // @ts-ignore
        mockNow.mockReturnValue(new Date('2023-01-01T12:00:00Z'));
        // @ts-ignore
        mockConstructOutputDirectory.mockResolvedValue('/output/path');
        // @ts-ignore
        mockConstructFilename.mockResolvedValue('transcription.txt');
    });

    describe('create', () => {
        test('should create a locate instance with correct dependencies', () => {
            const runConfig = {
                timezone: 'UTC',
                outputStructure: 'month' as FilesystemStructure,
                filenameOptions: ['date', 'time'] as FilenameOption[],
                outputDirectory: '/output',
                dryRun: false,
                verbose: false,
                debug: false,
                diff: false,
                log: false,
                model: 'gpt-4o-mini',
                transcriptionModel: 'whisper-1',
                contentTypes: ['diff'],
                recursive: false,
                inputDirectory: './',
                audioExtensions: ['mp3', 'wav'],
                configDir: './.transote',
                overrides: false,
                classifyModel: 'gpt-4o-mini',
                composeModel: 'gpt-4o-mini',
                processedDirectory: './processed'
            };

            // Mock Dreadcabinet operator
            const mockOperator = {
                constructOutputDirectory: mockConstructOutputDirectory,
                constructFilename: mockConstructFilename,
                // @ts-ignore
                process: vi.fn()
            };

            // @ts-ignore
            const instance = LocatePhase.create(runConfig, mockOperator);
            expect(instance).toBeDefined();
            expect(instance.locate).toBeDefined();
        });
    });

    describe('locate', () => {
        test('should process audio file and return correct metadata', async () => {
            const runConfig = {
                timezone: 'UTC',
                outputStructure: 'month' as FilesystemStructure,
                filenameOptions: ['date', 'time'] as FilenameOption[],
                outputDirectory: '/output',
                dryRun: false,
                verbose: false,
                debug: false,
                diff: false,
                log: false,
                model: 'gpt-4o-mini',
                transcriptionModel: 'whisper-1',
                contentTypes: ['diff'],
                recursive: false,
                inputDirectory: './',
                audioExtensions: ['mp3', 'wav'],
                configDir: './.transote',
                overrides: false,
                classifyModel: 'gpt-4o-mini',
                composeModel: 'gpt-4o-mini',
                processedDirectory: './processed'
            };

            // Mock Dreadcabinet operator
            const mockOperator = {
                constructOutputDirectory: mockConstructOutputDirectory,
                constructFilename: mockConstructFilename,
                // @ts-ignore
                process: vi.fn()
            };

            // @ts-ignore
            const instance = LocatePhase.create(runConfig, mockOperator);
            const result = await instance.locate('/path/to/audio.mp3');

            // Intermediate files now go to output/protokoll instead of polluting output directory
            expect(result.creationTime).toEqual(new Date('2023-01-01T12:00:00Z'));
            expect(result.outputPath).toBe('/output/path');
            expect(result.transcriptionFilename).toBe('transcription.txt');
            expect(result.hash).toBe('12345678');
            expect(result.audioFile).toBe('/path/to/audio.mp3');
            // interimPath should be under output/protokoll with timestamp-hash format
            expect(result.interimPath).toContain('output/protokoll/');
            expect(result.contextPath).toContain('output/protokoll/');

            expect(mockGetAudioCreationTime).toHaveBeenCalledWith('/path/to/audio.mp3');
            expect(mockHashFile).toHaveBeenCalledWith('/path/to/audio.mp3', 100);
            expect(mockConstructOutputDirectory).toHaveBeenCalledWith(new Date('2023-01-01T12:00:00Z'));
            expect(mockConstructFilename).toHaveBeenCalledWith(new Date('2023-01-01T12:00:00Z'), 'transcription', '12345678');
        });

        test('should use current date when creation time cannot be determined', async () => {
            // @ts-ignore
            mockGetAudioCreationTime.mockResolvedValueOnce(null);

            const runConfig = {
                timezone: 'UTC',
                outputStructure: 'month' as FilesystemStructure,
                filenameOptions: ['date', 'time'] as FilenameOption[],
                outputDirectory: '/output',
                dryRun: false,
                verbose: false,
                debug: false,
                diff: false,
                log: false,
                model: 'gpt-4o-mini',
                transcriptionModel: 'whisper-1',
                contentTypes: ['diff'],
                recursive: false,
                inputDirectory: './',
                audioExtensions: ['mp3', 'wav'],
                configDir: './.transote',
                overrides: false,
                classifyModel: 'gpt-4o-mini',
                composeModel: 'gpt-4o-mini',
                processedDirectory: './processed'
            };

            // Mock Dreadcabinet operator
            const mockOperator = {
                constructOutputDirectory: mockConstructOutputDirectory,
                constructFilename: mockConstructFilename,
                // @ts-ignore
                process: vi.fn()
            };

            // @ts-ignore
            const instance = LocatePhase.create(runConfig, mockOperator);

            const result = await instance.locate('/path/to/audio.mp3');

            // Verify the result uses the current date from mockNow
            expect(result.creationTime).toEqual(new Date('2023-01-01T12:00:00Z'));
            expect(result.outputPath).toEqual('/output/path');
            expect(result.transcriptionFilename).toEqual('transcription.txt');
            expect(result.hash).toEqual('12345678');
            expect(result.audioFile).toEqual('/path/to/audio.mp3');

            // Verify the warning was logged
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Could not determine audio recording time for %s, using current date',
                '/path/to/audio.mp3'
            );

            // Verify the mocks were called with correct parameters
            expect(mockGetAudioCreationTime).toHaveBeenCalledWith('/path/to/audio.mp3');
            expect(mockNow).toHaveBeenCalled();
            expect(mockHashFile).toHaveBeenCalledWith('/path/to/audio.mp3', 100);
            expect(mockConstructOutputDirectory).toHaveBeenCalledWith(new Date('2023-01-01T12:00:00Z'));
            expect(mockConstructFilename).toHaveBeenCalledWith(new Date('2023-01-01T12:00:00Z'), 'transcription', '12345678');
        });
    });
});
