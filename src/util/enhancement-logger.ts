/**
 * Enhancement Logger
 * 
 * Utility for logging enhancement pipeline steps to the enhancement_log table.
 * Provides a simple interface that can be passed to pipeline phases.
 */

import type { EnhancementLogManager, EntityReference } from '@redaksjon/protokoll-format';

export interface EnhancementLogger {
  logStep(
    phase: 'transcribe' | 'enhance' | 'simple-replace',
    action: string,
    details?: Record<string, unknown>,
    entities?: EntityReference[]
  ): void;
  
  logSteps(steps: Array<{
    phase: 'transcribe' | 'enhance' | 'simple-replace';
    action: string;
    details?: Record<string, unknown>;
    entities?: EntityReference[];
  }>): void;
}

/**
 * Create an enhancement logger from an EnhancementLogManager
 */
export function createEnhancementLogger(manager: EnhancementLogManager): EnhancementLogger {
    return {
        logStep(phase, action, details, entities) {
            manager.logStep(new Date(), phase, action, details, entities);
        },
    
        logSteps(steps) {
            manager.logSteps(steps.map(step => ({
                ...step,
                timestamp: new Date(),
            })));
        },
    };
}

/**
 * Create a no-op logger for when enhancement logging is not available
 */
export function createNoOpLogger(): EnhancementLogger {
    return {
        logStep() {
            // No-op
        },
        logSteps() {
            // No-op
        },
    };
}
