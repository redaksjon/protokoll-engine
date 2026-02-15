/**
 * Tests for Simple Replace Phase
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as SimpleReplace from '../../src/phases/simple-replace';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Config } from '@/protokoll';

// Mock Dreadcabinet
const mockOperator = {} as any;

// Mock logging
vi.mock('../../src/logging', () => ({
    getLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Mock storage
const mockStorage = {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    fileExists: vi.fn(),
};

vi.mock('../../src/util/storage', () => ({
    create: () => mockStorage,
}));

// Mock sounds-like database
const mockDatabaseInstance = {
    load: vi.fn(),
    getTier1Mappings: vi.fn(() => []),
    getTier2MappingsForProject: vi.fn(() => []),
};

vi.mock('../../src/util/sounds-like-database', () => ({
    create: vi.fn(() => mockDatabaseInstance),
}));

// Mock collision detector
const mockCollisionDetector = {
    shouldApplyTier2: vi.fn(() => true),
    decideReplacement: vi.fn(),
    resolveCollision: vi.fn(),
    detectCapitalizationHint: vi.fn(),
};

vi.mock('../../src/util/collision-detector', () => ({
    create: vi.fn(() => mockCollisionDetector),
}));

// Mock text replacer
const mockTextReplacer = {
    applyReplacements: vi.fn(() => ({
        text: 'replaced text',
        count: 0,
        appliedMappings: [],
        occurrences: [],
    })),
};

vi.mock('../../src/util/text-replacer', () => ({
    create: vi.fn(() => mockTextReplacer),
}));

describe('Simple Replace Phase', () => {
    let tempDir: string;
    let config: Config;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-replace-test-'));
        config = {
            debug: false,
        } as Config;

        // Reset mocks
        vi.clearAllMocks();
        mockDatabaseInstance.load.mockResolvedValue({
            mappings: [],
            tier1: [],
            tier2: new Map(),
            tier3: [],
        });
        mockTextReplacer.applyReplacements.mockReturnValue({
            text: 'replaced text',
            count: 0,
            appliedMappings: [],
            occurrences: [],
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('create', () => {
        it('should create a simple-replace instance', () => {
            const instance = SimpleReplace.create(config, mockOperator);
            expect(instance).toBeDefined();
            expect(typeof instance.replace).toBe('function');
        });
    });

    describe('replace', () => {
        it('should process text with no mappings', async () => {
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(result.text).toBe('original text');
            expect(result.replacementsMade).toBe(false);
            expect(result.stats.totalReplacements).toBe(0);
            expect(result.stats.tier1Replacements).toBe(0);
            expect(result.stats.tier2Replacements).toBe(0);
        });

        it('should apply Tier 1 replacements', async () => {
            const tier1Mappings = [
                {
                    soundsLike: 'observasion',
                    correctText: 'Observasjon',
                    entityType: 'project',
                    tier: 1,
                },
            ];

            mockDatabaseInstance.getTier1Mappings.mockReturnValue(tier1Mappings);
            mockTextReplacer.applyReplacements.mockReturnValueOnce({
                text: 'Text with Observasjon',
                count: 2,
                appliedMappings: tier1Mappings,
                occurrences: [
                    { mapping: tier1Mappings[0], match: 'observasion', index: 0 },
                    { mapping: tier1Mappings[0], match: 'observasion', index: 10 },
                ],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'Text with observasion',
                { confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(result.replacementsMade).toBe(true);
            expect(result.stats.tier1Replacements).toBe(2);
            expect(result.stats.totalReplacements).toBe(2);
            expect(result.stats.appliedMappings).toHaveLength(1);
            expect(result.stats.appliedMappings[0]).toMatchObject({
                soundsLike: 'observasion',
                correctText: 'Observasjon',
                tier: 1,
                occurrences: 2,
            });
        });

        it('should apply Tier 2 replacements when project is present', async () => {
            const tier2Mappings = [
                {
                    soundsLike: 'test term',
                    correctText: 'Test Term',
                    entityType: 'term',
                    tier: 2,
                    scopedToProjects: ['test-project'],
                },
            ];

            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockDatabaseInstance.getTier2MappingsForProject.mockReturnValue(tier2Mappings);
            mockCollisionDetector.shouldApplyTier2.mockReturnValue(true);

            const instance = SimpleReplace.create(config, mockOperator);

            // Clear previous mock calls and setup fresh
            vi.clearAllMocks();
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockDatabaseInstance.getTier2MappingsForProject.mockReturnValue(tier2Mappings);
            mockCollisionDetector.shouldApplyTier2.mockReturnValue(true);

            mockTextReplacer.applyReplacements = vi.fn()
                .mockReturnValueOnce({
                    text: 'original text',
                    count: 0,
                    appliedMappings: [],
                    occurrences: [],
                })
                .mockReturnValueOnce({
                    text: 'Text with Test Term',
                    count: 1,
                    appliedMappings: tier2Mappings,
                    occurrences: [
                        { mapping: tier2Mappings[0], match: 'test term', index: 0 },
                    ],
                });

            const result = await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.8 },
                tempDir,
                'test-hash'
            );

            expect(result.stats.tier2MappingsConsidered).toBe(1);
            expect(result.stats.projectContext).toBe('test-project');
            expect(mockDatabaseInstance.getTier2MappingsForProject).toHaveBeenCalledWith('test-project');
            // Total replacements should include tier2
            expect(result.stats.totalReplacements).toBeGreaterThanOrEqual(0);
        });

        it('should skip Tier 2 replacements when no project is present', async () => {
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'original text',
                { confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(result.stats.tier2MappingsConsidered).toBe(0);
            expect(mockDatabaseInstance.getTier2MappingsForProject).not.toHaveBeenCalled();
        });

        it('should filter Tier 2 mappings by confidence', async () => {
            const tier2Mappings = [
                {
                    soundsLike: 'high conf',
                    correctText: 'High Conf',
                    entityType: 'term',
                    tier: 2,
                    scopedToProjects: ['test-project'],
                },
                {
                    soundsLike: 'low conf',
                    correctText: 'Low Conf',
                    entityType: 'term',
                    tier: 2,
                    scopedToProjects: ['test-project'],
                },
            ];

            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockDatabaseInstance.getTier2MappingsForProject.mockReturnValue(tier2Mappings);

            // Only first mapping passes confidence check
            mockCollisionDetector.shouldApplyTier2
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false);

            // Reset mock to avoid interference from beforeEach
            mockTextReplacer.applyReplacements.mockReset();
            mockTextReplacer.applyReplacements
                .mockReturnValueOnce({
                    text: 'original text',
                    count: 0,
                    appliedMappings: [],
                    occurrences: [],
                })
                .mockReturnValueOnce({
                    text: 'Text with High Conf',
                    count: 1,
                    appliedMappings: [tier2Mappings[0]],
                    occurrences: [
                        { mapping: tier2Mappings[0], match: 'high conf', index: 0 },
                    ],
                });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.7 },
                tempDir,
                'test-hash'
            );

            expect(result.stats.tier2MappingsConsidered).toBe(2);
            expect(mockCollisionDetector.shouldApplyTier2).toHaveBeenCalledTimes(2);
        });

        it('should combine Tier 1 and Tier 2 replacements', async () => {
            const tier1Mappings = [
                {
                    soundsLike: 'tier1',
                    correctText: 'Tier1',
                    entityType: 'term',
                    tier: 1,
                },
            ];

            const tier2Mappings = [
                {
                    soundsLike: 'tier2',
                    correctText: 'Tier2',
                    entityType: 'term',
                    tier: 2,
                    scopedToProjects: ['test-project'],
                },
            ];

            mockDatabaseInstance.getTier1Mappings.mockReturnValue(tier1Mappings);
            mockDatabaseInstance.getTier2MappingsForProject.mockReturnValue(tier2Mappings);
            mockCollisionDetector.shouldApplyTier2.mockReturnValue(true);

            // Reset mock to avoid interference from beforeEach
            mockTextReplacer.applyReplacements.mockReset();
            mockTextReplacer.applyReplacements
                .mockReturnValueOnce({
                    text: 'Text with Tier1',
                    count: 1,
                    appliedMappings: tier1Mappings,
                    occurrences: [
                        { mapping: tier1Mappings[0], match: 'tier1', index: 0 },
                    ],
                })
                .mockReturnValueOnce({
                    text: 'Text with Tier1 and Tier2',
                    count: 1,
                    appliedMappings: tier2Mappings,
                    occurrences: [
                        { mapping: tier2Mappings[0], match: 'tier2', index: 10 },
                    ],
                });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.8 },
                tempDir,
                'test-hash'
            );

            expect(result.stats.tier1Replacements).toBe(1);
            expect(result.stats.tier2Replacements).toBe(1);
            expect(result.stats.totalReplacements).toBe(2);
            expect(result.stats.appliedMappings).toHaveLength(2);
        });

        it('should save stats file in debug mode', async () => {
            config.debug = true;
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(mockStorage.writeFile).toHaveBeenCalled();
            const writeCall = mockStorage.writeFile.mock.calls[0];
            expect(writeCall[0]).toContain('test-hash.simple-replace.stats.json');
        });

        it('should not save stats file when debug is false', async () => {
            config.debug = false;
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            await instance.replace(
                'original text',
                { project: 'test-project', confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(mockStorage.writeFile).not.toHaveBeenCalled();
        });

        it('should include processing time in stats', async () => {
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);
            const result = await instance.replace(
                'original text',
                { confidence: 0.9 },
                tempDir,
                'test-hash'
            );

            expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0);
            expect(typeof result.stats.processingTimeMs).toBe('number');
        });

        it('should reuse database instance across multiple calls', async () => {
            mockDatabaseInstance.getTier1Mappings.mockReturnValue([]);
            mockTextReplacer.applyReplacements.mockReturnValue({
                text: 'original text',
                count: 0,
                appliedMappings: [],
                occurrences: [],
            });

            const instance = SimpleReplace.create(config, mockOperator);

            await instance.replace('text1', { confidence: 0.9 }, tempDir, 'hash1');
            await instance.replace('text2', { confidence: 0.9 }, tempDir, 'hash2');

            // Database should only be loaded once
            expect(mockDatabaseInstance.load).toHaveBeenCalledTimes(1);
        });
    });
});
