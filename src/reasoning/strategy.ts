/**
 * Reasoning Strategy
 * 
 * Strategy factory for different transcription processing approaches.
 * Uses riotprompt's IterationStrategyFactory for complex workflows.
 */

import { IterationStrategy, IterationStrategyFactory } from '@kjerneverk/riotprompt';
import { ReasoningLevel } from './types';

export type TranscriptionStrategy = 
    | 'simple'                    // Basic completion
    | 'investigate-then-respond'  // Use tools to gather info, then respond
    | 'multi-pass'               // Multiple refinement passes
    | 'adaptive';                // Changes based on complexity

export interface StrategyConfig {
    type: TranscriptionStrategy;
    maxIterations?: number;
    requireMinimumTools?: number;
    reasoningLevel?: ReasoningLevel;
}

export const createStrategy = (config: StrategyConfig): IterationStrategy => {
    const maxIterations = config.maxIterations ?? getDefaultIterations(config.type);
  
    switch (config.type) {
        case 'simple':
            return IterationStrategyFactory.simple({
                maxIterations,
                allowTools: false,
            });
    
        case 'investigate-then-respond':
            return IterationStrategyFactory.investigateThenRespond({
                maxInvestigationSteps: Math.floor(maxIterations * 0.8),
                requireMinimumTools: config.requireMinimumTools ?? 2,
                finalSynthesis: true,
            });
    
        case 'multi-pass':
            return IterationStrategyFactory.multiPassRefinement({
                passes: 3,
                critiqueBetweenPasses: true,
            });
    
        case 'adaptive':
            return IterationStrategyFactory.adaptive({});
    
        default:
            return IterationStrategyFactory.simple({ maxIterations });
    }
};

const getDefaultIterations = (type: TranscriptionStrategy): number => {
    switch (type) {
        case 'simple': return 1;
        case 'investigate-then-respond': return 15;
        case 'multi-pass': return 6;
        case 'adaptive': return 20;
        default: return 10;
    }
};

export const getRecommendedStrategy = (
    transcriptLength: number,
    hasUnknownNames: boolean,
    complexity: 'low' | 'medium' | 'high'
): TranscriptionStrategy => {
    // Short, simple transcripts
    if (transcriptLength < 500 && !hasUnknownNames && complexity === 'low') {
        return 'simple';
    }
  
    // Complex or with unknowns - need investigation
    if (hasUnknownNames || complexity === 'high') {
        return 'investigate-then-respond';
    }
  
    // Medium complexity - adaptive is good
    return 'adaptive';
};

