/**
 * Simple Replace Phase
 *
 * Performs intelligent, context-aware string replacement for entity correction.
 * This phase runs after transcription and routing to correct entity names using
 * sounds_like mappings from the protokoll context.
 *
 * Part of the simple-replace optimization (Phase 2).
 */

import * as Dreadcabinet from '@utilarium/dreadcabinet';
import { Config } from '@/types';
import * as Logging from '@/logging';
import * as Storage from '@/util/storage';
import * as SoundsLikeDatabase from '@/util/sounds-like-database';
import * as CollisionDetector from '@/util/collision-detector';
import * as TextReplacer from '@/util/text-replacer';
import { stringifyJSON } from '@/util/general';
import path from 'path';

/**
 * Classification/routing information for context
 */
export interface Classification {
    project?: string;
    confidence?: number;
    [key: string]: any;
}

/**
 * Statistics about the simple-replace phase
 */
export interface SimpleReplaceStats {
    /** Number of Tier 1 (always safe) replacements made */
    tier1Replacements: number;

    /** Number of Tier 2 (project-scoped) replacements made */
    tier2Replacements: number;

    /** Total replacements made */
    totalReplacements: number;

    /** Number of Tier 1 mappings considered */
    tier1MappingsConsidered: number;

    /** Number of Tier 2 mappings considered */
    tier2MappingsConsidered: number;

    /** Project context used (if any) */
    projectContext?: string;

    /** Classification confidence */
    classificationConfidence?: number;

    /** Processing time in milliseconds */
    processingTimeMs: number;

    /** Applied mappings details */
    appliedMappings: Array<{
        soundsLike: string;
        correctText: string;
        tier: number;
        occurrences: number;
    }>;
}

/**
 * Result of the simple-replace phase
 */
export interface SimpleReplaceResult {
    /** The text after replacements */
    text: string;

    /** Statistics about the replacements */
    stats: SimpleReplaceStats;

    /** Whether any replacements were made */
    replacementsMade: boolean;
}

/**
 * Instance interface for simple-replace phase
 */
export interface Instance {
    /**
     * Apply simple-replace to transcription text using routing context
     */
    replace(
        transcriptionText: string,
        classification: Classification,
        interimPath: string,
        hash: string
    ): Promise<SimpleReplaceResult>;
}

/**
 * Create a simple-replace phase instance
 */
export const create = (config: Config, _operator: Dreadcabinet.Operator): Instance => {
    const logger = Logging.getLogger();
    const storage = Storage.create({ log: logger.debug });

    // Initialize database and utilities (load once, reuse across files)
    let database: SoundsLikeDatabase.SoundsLikeDatabase | null = null;
    let dbInstance: SoundsLikeDatabase.Instance | null = null;
    let collisionDetector: CollisionDetector.Instance | null = null;
    let textReplacer: TextReplacer.Instance | null = null;

    /**
     * Lazy load the sounds-like database
     */
    const loadDatabase = async (): Promise<SoundsLikeDatabase.SoundsLikeDatabase> => {
        if (database) {
            return database;
        }

        logger.info('Loading sounds-like database for simple-replace phase');

        dbInstance = SoundsLikeDatabase.create();
        database = await dbInstance.load();

        logger.info(
            `Loaded sounds-like database: ${database.mappings.length} total mappings ` +
            `(Tier 1: ${database.tier1.length}, Tier 2: ${Array.from(database.tier2.values()).reduce((sum, arr) => sum + arr.length, 0)}, ` +
            `Tier 3: ${database.tier3.length})`
        );

        return database;
    };

    /**
     * Get or create collision detector
     */
    const getCollisionDetector = (): CollisionDetector.Instance => {
        if (!collisionDetector) {
            collisionDetector = CollisionDetector.create({
                tier2MinConfidence: 0.6,
            });
        }
        return collisionDetector;
    };

    /**
     * Get or create text replacer
     */
    const getTextReplacer = (): TextReplacer.Instance => {
        if (!textReplacer) {
            textReplacer = TextReplacer.create({
                // Use preserveCase: false for entity names (we want "observasion" → "Observasjon" not "observasjon")
                preserveCase: false,
                useWordBoundaries: true,
                caseInsensitive: true,
            });
        }
        return textReplacer;
    };

    /**
     * Main replace function
     */
    const replace = async (
        transcriptionText: string,
        classification: Classification,
        interimPath: string,
        hash: string
    ): Promise<SimpleReplaceResult> => {
        const startTime = Date.now();

        logger.info('Starting simple-replace phase');
        logger.debug(
            `Classification context: project="${classification.project}", ` +
            `confidence=${classification.confidence}`
        );

        // Load database
        await loadDatabase();
        const detector = getCollisionDetector();
        const replacer = getTextReplacer();

        // Prepare stats
        const stats: SimpleReplaceStats = {
            tier1Replacements: 0,
            tier2Replacements: 0,
            totalReplacements: 0,
            tier1MappingsConsidered: 0,
            tier2MappingsConsidered: 0,
            projectContext: classification.project,
            classificationConfidence: classification.confidence,
            processingTimeMs: 0,
            appliedMappings: [],
        };

        let resultText = transcriptionText;

        // STEP 1: Apply Tier 1 replacements (always safe)
        const tier1Mappings = dbInstance!.getTier1Mappings();
        stats.tier1MappingsConsidered = tier1Mappings.length;

        if (tier1Mappings.length > 0) {
            logger.debug(`Applying ${tier1Mappings.length} Tier 1 (always safe) mappings`);

            const tier1Result = replacer.applyReplacements(resultText, tier1Mappings);
            resultText = tier1Result.text;
            stats.tier1Replacements = tier1Result.count;

            for (const mapping of tier1Result.appliedMappings) {
                const occurrences = tier1Result.occurrences.filter(
                    o => o.mapping.soundsLike === mapping.soundsLike
                ).length;

                stats.appliedMappings.push({
                    soundsLike: mapping.soundsLike,
                    correctText: mapping.correctText,
                    tier: 1,
                    occurrences,
                });
            }
        }

        // STEP 2: Apply Tier 2 replacements (project-scoped)
        if (classification.project) {
            const tier2Mappings = dbInstance!.getTier2MappingsForProject(classification.project);
            stats.tier2MappingsConsidered = tier2Mappings.length;

            if (tier2Mappings.length > 0) {
                logger.debug(
                    `Applying ${tier2Mappings.length} Tier 2 (project-scoped) mappings ` +
                    `for project "${classification.project}"`
                );

                // Filter Tier 2 mappings by confidence and project match
                const applicableTier2 = tier2Mappings.filter(mapping =>
                    detector.shouldApplyTier2(mapping, classification)
                );

                logger.debug(
                    `${applicableTier2.length} of ${tier2Mappings.length} Tier 2 mappings passed ` +
                    `confidence and project checks`
                );

                if (applicableTier2.length > 0) {
                    const tier2Result = replacer.applyReplacements(resultText, applicableTier2);
                    resultText = tier2Result.text;
                    stats.tier2Replacements = tier2Result.count;

                    for (const mapping of tier2Result.appliedMappings) {
                        const occurrences = tier2Result.occurrences.filter(
                            o => o.mapping.soundsLike === mapping.soundsLike
                        ).length;

                        stats.appliedMappings.push({
                            soundsLike: mapping.soundsLike,
                            correctText: mapping.correctText,
                            tier: 2,
                            occurrences,
                        });
                    }
                }
            }
        } else {
            logger.debug('No project in classification, skipping Tier 2 replacements');
        }

        // Calculate totals
        stats.totalReplacements = stats.tier1Replacements + stats.tier2Replacements;
        stats.processingTimeMs = Date.now() - startTime;

        // Log summary
        logger.info(
            `Simple-replace phase complete: ${stats.totalReplacements} replacements made ` +
            `(Tier 1: ${stats.tier1Replacements}, Tier 2: ${stats.tier2Replacements}) ` +
            `in ${stats.processingTimeMs}ms`
        );

        // Save stats to interim file if in debug mode
        if (config.debug) {
            const statsFilename = `${hash}.simple-replace.stats.json`;
            const statsPath = path.join(interimPath, statsFilename);

            await storage.writeFile(
                statsPath,
                stringifyJSON({
                    stats,
                    classification: {
                        project: classification.project,
                        confidence: classification.confidence,
                    },
                    tier1MappingsConsidered: tier1Mappings.map(m => ({
                        soundsLike: m.soundsLike,
                        correctText: m.correctText,
                    })),
                }),
                'utf8'
            );

            logger.debug(`Saved simple-replace stats to ${statsPath}`);
        }

        return {
            text: resultText,
            stats,
            replacementsMade: stats.totalReplacements > 0,
        };
    };

    return {
        replace,
    };
};
