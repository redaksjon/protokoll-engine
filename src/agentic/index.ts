/**
 * Agentic Transcription System
 * 
 * Main entry point for the agentic transcription system. Provides tool-based
 * enhancement of transcripts using reasoning models.
 * 
 * The agentic approach means the model queries context via tools rather than
 * receiving all context upfront in the prompt. This allows for:
 * - Smaller prompt sizes
 * - More targeted context retrieval  
 * - Better handling of large context sets
 */

import { ToolContext, TranscriptionState } from './types';
import * as Executor from './executor';
import * as Registry from './registry';
import * as Reasoning from '../reasoning';

export interface ContextChangeRecord {
    entityType: 'person' | 'project' | 'company' | 'term' | 'ignored';
    entityId: string;
    entityName: string;
    action: 'created' | 'updated';
    details?: Record<string, unknown>;
}

export interface AgenticInstance {
    process(transcriptText: string): Promise<{
        enhancedText: string;
        state: TranscriptionState;
        toolsUsed: string[];
        iterations: number;
        totalTokens?: number;
        contextChanges?: ContextChangeRecord[];
    }>;
    getAvailableTools(): string[];
}

/**
 * Create an agentic executor from a ToolContext
 * This is the primary factory method - always agentic, no flags needed
 */
export const create = (
    reasoning: Reasoning.ReasoningInstance,
    toolContext: ToolContext
): AgenticInstance => {
    const executor = Executor.create(reasoning, toolContext);
    
    return {
        process: (transcriptText: string) => executor.process(transcriptText),
    
        getAvailableTools: () => {
            const registry = Registry.create(toolContext);
            return registry.getTools().map(t => t.name);
        },
    };
};

// Re-export types
export * from './types';

