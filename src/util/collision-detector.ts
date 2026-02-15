/**
 * Collision Detector
 *
 * Provides utilities for detecting and resolving collisions in sounds_like mappings.
 * Helps determine when it's safe to apply a replacement and when context is needed.
 *
 * Part of the simple-replace optimization (Phase 1).
 */

import * as Logging from '@/logging';
import { SoundsLikeMapping, Collision } from './sounds-like-database';

/**
 * Classification result for an entity
 */
export interface Classification {
    /** Identified project ID */
    project?: string;

    /** Classification confidence (0-1) */
    confidence?: number;

    /** Additional classification metadata */
    [key: string]: any;
}

/**
 * Replacement decision
 */
export interface ReplacementDecision {
    /** Whether to apply the replacement */
    shouldReplace: boolean;

    /** The mapping to use (if shouldReplace is true) */
    mapping?: SoundsLikeMapping;

    /** Reason for the decision */
    reason: string;

    /** Confidence in this decision (0-1) */
    confidence: number;
}

/**
 * Context for collision resolution
 */
export interface CollisionContext {
    /** Classification of the transcription */
    classification: Classification;

    /** The sounds_like value being considered */
    soundsLike: string;

    /** Available mappings for this sounds_like */
    availableMappings: SoundsLikeMapping[];

    /** Surrounding text context (optional) */
    surroundingText?: string;
}

/**
 * Instance interface for collision detector
 */
export interface Instance {
    /**
     * Decide whether to apply a replacement given a collision context
     */
    decideReplacement(context: CollisionContext): ReplacementDecision;

    /**
     * Check if a Tier 2 mapping should be applied given classification
     */
    shouldApplyTier2(mapping: SoundsLikeMapping, classification: Classification): boolean;

    /**
     * Resolve a collision by selecting the best mapping
     */
    resolveCollision(collision: Collision, classification: Classification): SoundsLikeMapping | null;

    /**
     * Detect capitalization hints in context
     */
    detectCapitalizationHint(soundsLike: string, surroundingText: string): 'proper-noun' | 'common-term' | 'unknown';
}

/**
 * Configuration for collision detector
 */
export interface CollisionDetectorConfig {
    /** Minimum confidence for Tier 2 replacements (default: 0.6) */
    tier2MinConfidence?: number;

    /** High confidence threshold for aggressive replacement (default: 0.8) */
    tier2HighConfidence?: number;

    /** Enable capitalization hints (default: true) */
    useCapitalizationHints?: boolean;

    /** Enable surrounding text analysis (default: false, future feature) */
    useSurroundingText?: boolean;
}

/**
 * Create a collision detector instance
 */
export const create = (config?: CollisionDetectorConfig): Instance => {
    const logger = Logging.getLogger();

    const tier2MinConfidence = config?.tier2MinConfidence ?? 0.6;
    // const tier2HighConfidence = config?.tier2HighConfidence ?? 0.8; // Reserved for future use
    const useCapitalizationHints = config?.useCapitalizationHints ?? true;

    /**
     * Check if a Tier 2 mapping should be applied
     */
    const shouldApplyTier2 = (
        mapping: SoundsLikeMapping,
        classification: Classification
    ): boolean => {
        // Must be Tier 2
        if (mapping.tier !== 2) {
            return false;
        }

        // Check confidence threshold
        const confidence = classification.confidence ?? 0;
        const minConfidence = mapping.minConfidence ?? tier2MinConfidence;

        if (confidence < minConfidence) {
            logger.debug(
                `Skipping Tier 2 replacement for "${mapping.soundsLike}": ` +
                `confidence ${confidence} < ${minConfidence}`
            );
            return false;
        }

        // For project-scoped mappings, check if project matches
        if (mapping.scopedToProjects && mapping.scopedToProjects.length > 0) {
            const classifiedProject = classification.project;

            if (!classifiedProject) {
                logger.debug(
                    `Skipping Tier 2 replacement for "${mapping.soundsLike}": ` +
                    `no project in classification`
                );
                return false;
            }

            if (!mapping.scopedToProjects.includes(classifiedProject)) {
                logger.debug(
                    `Skipping Tier 2 replacement for "${mapping.soundsLike}": ` +
                    `project "${classifiedProject}" not in scope [${mapping.scopedToProjects.join(', ')}]`
                );
                return false;
            }
        }

        logger.debug(
            `Applying Tier 2 replacement for "${mapping.soundsLike}" → "${mapping.correctText}" ` +
            `(project: ${classification.project}, confidence: ${confidence})`
        );
        return true;
    };

    /**
     * Resolve a collision by selecting the best mapping
     */
    const resolveCollision = (
        collision: Collision,
        classification: Classification
    ): SoundsLikeMapping | null => {
        const { soundsLike, mappings } = collision;

        logger.debug(`Resolving collision for "${soundsLike}" (${mappings.length} candidates)`);

        // Filter to Tier 1 and applicable Tier 2 mappings
        const tier1Mappings = mappings.filter(m => m.tier === 1);
        const tier2Mappings = mappings.filter(m => m.tier === 2 && shouldApplyTier2(m, classification));

        // Prefer Tier 1 if available (always safe)
        if (tier1Mappings.length === 1) {
            logger.debug(`Resolved collision: using Tier 1 mapping "${tier1Mappings[0].correctText}"`);
            return tier1Mappings[0];
        }

        // If multiple Tier 1 mappings, this is ambiguous (shouldn't happen in practice)
        if (tier1Mappings.length > 1) {
            logger.warn(`Multiple Tier 1 mappings for "${soundsLike}", skipping replacement`);
            return null;
        }

        // Try Tier 2 mappings that match classification
        if (tier2Mappings.length === 1) {
            logger.debug(`Resolved collision: using Tier 2 mapping "${tier2Mappings[0].correctText}"`);
            return tier2Mappings[0];
        }

        // If multiple Tier 2 mappings match, this is ambiguous
        if (tier2Mappings.length > 1) {
            logger.debug(`Multiple Tier 2 mappings match for "${soundsLike}", skipping replacement`);
            return null;
        }

        // No applicable mappings
        logger.debug(`No applicable mappings for collision "${soundsLike}"`);
        return null;
    };

    /**
     * Detect capitalization hints in surrounding text
     */
    const detectCapitalizationHint = (
        soundsLike: string,
        surroundingText: string
    ): 'proper-noun' | 'common-term' | 'unknown' => {
        if (!useCapitalizationHints || !surroundingText) {
            return 'unknown';
        }

        // Find the sounds_like in the surrounding text
        const regex = new RegExp(`\\b${soundsLike}\\b`, 'i');
        const match = surroundingText.match(regex);

        if (!match) {
            return 'unknown';
        }

        const matchedText = match[0];

        // Check if it's capitalized
        const isCapitalized = matchedText[0] === matchedText[0].toUpperCase();

        if (!isCapitalized) {
            // Lowercase in text → likely common term
            return 'common-term';
        }

        // Capitalized - check if it's at sentence start
        const indexInText = surroundingText.indexOf(matchedText);

        // Look back for sentence boundaries
        const beforeText = surroundingText.substring(0, indexInText).trimEnd();
        const isAtSentenceStart = beforeText.length === 0 || /[.!?]\s*$/.test(beforeText);

        if (isAtSentenceStart) {
            // Capitalized at sentence start → ambiguous
            return 'unknown';
        }

        // Capitalized mid-sentence → likely proper noun
        return 'proper-noun';
    };

    /**
     * Decide whether to apply a replacement
     */
    const decideReplacement = (context: CollisionContext): ReplacementDecision => {
        const { classification, soundsLike, availableMappings, surroundingText } = context;

        // No mappings available
        if (availableMappings.length === 0) {
            return {
                shouldReplace: false,
                reason: 'No mappings available',
                confidence: 1.0,
            };
        }

        // Single mapping - straightforward
        if (availableMappings.length === 1) {
            const mapping = availableMappings[0];

            // Tier 1: Always apply
            if (mapping.tier === 1) {
                return {
                    shouldReplace: true,
                    mapping,
                    reason: 'Tier 1 mapping (always safe)',
                    confidence: 1.0,
                };
            }

            // Tier 2: Check conditions
            if (mapping.tier === 2) {
                if (shouldApplyTier2(mapping, classification)) {
                    return {
                        shouldReplace: true,
                        mapping,
                        reason: `Tier 2 mapping (project: ${classification.project}, confidence: ${classification.confidence})`,
                        confidence: classification.confidence ?? 0.5,
                    };
                } else {
                    return {
                        shouldReplace: false,
                        reason: 'Tier 2 conditions not met',
                        confidence: 0.5,
                    };
                }
            }

            // Tier 3: Skip
            return {
                shouldReplace: false,
                reason: 'Tier 3 mapping (too ambiguous)',
                confidence: 1.0,
            };
        }

        // Multiple mappings - collision scenario
        const resolvedMapping = resolveCollision(
            { soundsLike, mappings: availableMappings, count: availableMappings.length },
            classification
        );

        if (resolvedMapping) {
            return {
                shouldReplace: true,
                mapping: resolvedMapping,
                reason: `Collision resolved (${availableMappings.length} candidates)`,
                confidence: classification.confidence ?? 0.5,
            };
        }

        // Use capitalization hint as fallback (future enhancement)
        if (surroundingText && useCapitalizationHints) {
            const hint = detectCapitalizationHint(soundsLike, surroundingText);

            if (hint === 'common-term') {
                return {
                    shouldReplace: false,
                    reason: 'Capitalization hint suggests common term',
                    confidence: 0.7,
                };
            }
        }

        // Could not resolve collision
        return {
            shouldReplace: false,
            reason: 'Collision could not be resolved',
            confidence: 0.5,
        };
    };

    return {
        decideReplacement,
        shouldApplyTier2,
        resolveCollision,
        detectCapitalizationHint,
    };
};
