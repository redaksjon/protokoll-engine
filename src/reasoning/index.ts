/**
 * Reasoning System
 * 
 * Main entry point for the reasoning system. Provides a factory function
 * to create reasoning instances that can execute LLM calls with various
 * strategies using riotprompt.
 */

import { ReasoningConfig, ReasoningRequest, ReasoningResponse, ReasoningMetrics } from './types';
import * as Client from './client';
import * as Strategy from './strategy';

export interface ReasoningInstance {
    // Single completion
    complete(request: ReasoningRequest): Promise<ReasoningResponse>;
    
    // Multi-turn tool calling
    completeWithTools(request: Client.ToolCallRequest): Promise<Client.ToolCallResponse>;
  
    // Strategy-based execution
    executeWithStrategy(
        request: ReasoningRequest,
        strategyType: Strategy.TranscriptionStrategy
    ): Promise<ReasoningResponse & { metrics: ReasoningMetrics }>;
  
    // Model information
    isReasoningModel(model: string): boolean;
    getModelFamily(model: string): 'openai' | 'anthropic' | 'gemini' | 'unknown';
  
    // Strategy helpers
    getRecommendedStrategy(
        transcriptLength: number,
        hasUnknownNames: boolean,
        complexity: 'low' | 'medium' | 'high'
    ): Strategy.TranscriptionStrategy;
}

export const create = (config: ReasoningConfig): ReasoningInstance => {
    const client = Client.create(config);
  
    return {
        complete: (request) => client.complete(request),
        completeWithTools: (request) => client.completeWithTools(request),
    
        executeWithStrategy: async (request, strategyType) => {
            // Create the strategy (for future use with full agentic execution)
            Strategy.createStrategy({
                type: strategyType,
                maxIterations: request.maxIterations,
            });
      
            // For now, simple execution
            // Full strategy execution will be implemented in Step 05 (Agentic)
            const response = await client.complete(request);
      
            return {
                ...response,
                metrics: {
                    iterations: 1,
                    toolCallsExecuted: response.toolCalls?.length ?? 0,
                    totalDuration: response.duration ?? 0,
                    tokensUsed: response.usage?.totalTokens ?? 0,
                },
            };
        },
    
        isReasoningModel: client.isReasoningModel,
        getModelFamily: client.getModelFamily,
        getRecommendedStrategy: Strategy.getRecommendedStrategy,
    };
};

// Re-export types
export * from './types';
export type { TranscriptionStrategy, StrategyConfig } from './strategy';

