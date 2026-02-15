/**
 * Text Replacer
 *
 * Performs intelligent text replacements with case preservation and word boundary matching.
 * Core utility for the simple-replace phase.
 *
 * Part of the simple-replace optimization (Phase 2).
 */

import * as Logging from '@/logging';
import { SoundsLikeMapping } from './sounds-like-database';

/**
 * Replacement result for a single occurrence
 */
export interface ReplacementOccurrence {
    /** Original text that was replaced */
    original: string;

    /** Replacement text */
    replacement: string;

    /** Position in the text where replacement occurred */
    position: number;

    /** The mapping that was used */
    mapping: SoundsLikeMapping;
}

/**
 * Result of applying replacements to text
 */
export interface ReplacementResult {
    /** The text after replacements */
    text: string;

    /** Number of replacements made */
    count: number;

    /** Detailed information about each replacement */
    occurrences: ReplacementOccurrence[];

    /** Mappings that were applied */
    appliedMappings: SoundsLikeMapping[];
}

/**
 * Configuration for text replacer
 */
export interface TextReplacerConfig {
    /** Preserve case of original text when replacing (default: true) */
    preserveCase?: boolean;

    /** Use word boundaries for matching (default: true) */
    useWordBoundaries?: boolean;

    /** Case-insensitive matching (default: true) */
    caseInsensitive?: boolean;
}

/**
 * Instance interface for text replacer
 */
export interface Instance {
    /**
     * Apply a set of replacements to text
     */
    applyReplacements(text: string, mappings: SoundsLikeMapping[]): ReplacementResult;

    /**
     * Apply a single replacement to text
     */
    applySingleReplacement(text: string, mapping: SoundsLikeMapping): ReplacementResult;
}

/**
 * Create a text replacer instance
 */
export const create = (config?: TextReplacerConfig): Instance => {
    const logger = Logging.getLogger();

    const preserveCase = config?.preserveCase ?? true;
    const useWordBoundaries = config?.useWordBoundaries ?? true;
    const caseInsensitive = config?.caseInsensitive ?? true;

    /**
     * Determine the case style of a string
     */
    const getCaseStyle = (text: string): 'upper' | 'lower' | 'title' | 'mixed' => {
        // Check for all uppercase first (includes single chars)
        if (text.length > 0 && text === text.toUpperCase() && text.toUpperCase() !== text.toLowerCase()) {
            return 'upper';
        }
        // Check for all lowercase
        if (text === text.toLowerCase()) {
            return 'lower';
        }
        // Check for title case (first char upper, or mixed case starting with upper)
        if (text[0] === text[0].toUpperCase()) {
            return 'title';
        }
        return 'mixed';
    };

    /**
     * Apply case style from original to replacement
     *
     * Case preservation means: make the replacement match the case pattern of the original
     * - "protocol" (lowercase) → "protokoll" (lowercase)
     * - "Protocol" (title) → "Protokoll" (title)
     * - "PROTOCOL" (upper) → "PROTOKOLL" (upper)
     */
    const applyCaseStyle = (replacement: string, originalCase: 'upper' | 'lower' | 'title' | 'mixed'): string => {
        switch (originalCase) {
            case 'upper':
                // ALL CAPS in original → ALL CAPS in replacement
                return replacement.toUpperCase();
            case 'lower':
                // all lowercase in original → all lowercase in replacement
                return replacement.toLowerCase();
            case 'title':
                // Title Case in original → Title Case in replacement (first char upper, rest as-is)
                return replacement.charAt(0).toUpperCase() + replacement.slice(1);
            case 'mixed':
            default:
                // Mixed case → preserve replacement's original case
                return replacement;
        }
    };

    /**
     * Create a regex pattern for matching
     */
    const createPattern = (soundsLike: string): RegExp => {
        // Escape special regex characters
        const escaped = soundsLike.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Add word boundaries if enabled
        const pattern = useWordBoundaries ? `\\b${escaped}\\b` : escaped;

        // Create regex with appropriate flags
        const flags = caseInsensitive ? 'gi' : 'g';
        return new RegExp(pattern, flags);
    };

    /**
     * Apply a single replacement to text
     */
    const applySingleReplacement = (text: string, mapping: SoundsLikeMapping): ReplacementResult => {
        const pattern = createPattern(mapping.soundsLike);
        const occurrences: ReplacementOccurrence[] = [];
        let count = 0;

        // Track positions to avoid double-replacement issues
        const replacements: { index: number; length: number; replacement: string }[] = [];

        // Find all matches
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            const original = match[0];
            let replacement = mapping.correctText;

            // Preserve case if enabled
            if (preserveCase) {
                const caseStyle = getCaseStyle(original);
                replacement = applyCaseStyle(replacement, caseStyle);
            }

            replacements.push({
                index: match.index,
                length: original.length,
                replacement,
            });

            occurrences.push({
                original,
                replacement,
                position: match.index,
                mapping,
            });

            count++;
        }

        // Apply replacements in reverse order to preserve positions
        let resultText = text;
        for (let i = replacements.length - 1; i >= 0; i--) {
            const { index, length, replacement } = replacements[i];
            resultText = resultText.slice(0, index) + replacement + resultText.slice(index + length);
        }

        if (count > 0) {
            logger.debug(
                `Replaced "${mapping.soundsLike}" → "${mapping.correctText}" ` +
                `(${count} occurrence${count === 1 ? '' : 's'})`
            );
        }

        return {
            text: resultText,
            count,
            occurrences,
            appliedMappings: count > 0 ? [mapping] : [],
        };
    };

    /**
     * Apply multiple replacements to text
     */
    const applyReplacements = (text: string, mappings: SoundsLikeMapping[]): ReplacementResult => {
        let resultText = text;
        let totalCount = 0;
        const allOccurrences: ReplacementOccurrence[] = [];
        const appliedMappings: SoundsLikeMapping[] = [];

        // Apply each mapping sequentially
        for (const mapping of mappings) {
            const result = applySingleReplacement(resultText, mapping);

            if (result.count > 0) {
                resultText = result.text;
                totalCount += result.count;
                allOccurrences.push(...result.occurrences);
                appliedMappings.push(mapping);
            }
        }

        logger.debug(
            `Applied ${mappings.length} mappings, made ${totalCount} replacements ` +
            `(${appliedMappings.length} mappings had matches)`
        );

        return {
            text: resultText,
            count: totalCount,
            occurrences: allOccurrences,
            appliedMappings,
        };
    };

    return {
        applyReplacements,
        applySingleReplacement,
    };
};
