/**
 * Reasoning System Types
 *
 * Configuration and types for reasoning model integration.
 * Uses riotprompt for prompt building and execution.
 */

// Model families with reasoning capabilities
export type ReasoningModel =
    | 'claude-3-5-sonnet'
    | 'claude-3-opus'
    | 'claude-4'
    | 'gpt-4o'
    | 'gpt-4o-mini'
    | 'gpt-4-turbo'
    | 'gpt-5'
    | 'gpt-5-nano'
    | 'gpt-5-mini'
    | 'gpt-5.1'
    | 'gpt-5.2'
    | 'o1'
    | 'o1-mini'
    | 'o3'
    | 'o3-mini'
    | string;  // Allow any model string

export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high';

export interface ReasoningConfig {
    model: ReasoningModel;
    reasoningLevel?: ReasoningLevel;  // For models that support it (o1, etc.)
    maxTokens?: number;
    temperature?: number;
    apiKey?: string;  // Override default
    provider?: 'openai' | 'anthropic' | 'gemini' | 'auto';
}

export interface ReasoningRequest {
    prompt: string;
    systemPrompt?: string;
    context?: string[];
    maxIterations?: number;
    tools?: ToolDefinition[];
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ReasoningResponse {
    content: string;
    model: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    toolCalls?: ToolCall[];
    finishReason?: string;
    duration?: number;
}

export interface ReasoningMetrics {
    iterations: number;
    toolCallsExecuted: number;
    totalDuration: number;
    tokensUsed: number;
}

// Model-specific settings
export interface ModelSettings {
    maxTokens: number;
    supportsTools: boolean;
    reasoningLevel?: boolean;
}

export const REASONING_MODELS: Record<string, ModelSettings> = {
    'claude-3-5-sonnet': { maxTokens: 4096, supportsTools: true },
    'claude-3-opus': { maxTokens: 4096, supportsTools: true },
    'claude-4': { maxTokens: 8192, supportsTools: true },
    'gpt-4o': { maxTokens: 4096, supportsTools: true },
    'gpt-4o-mini': { maxTokens: 4096, supportsTools: true },
    'gpt-5': { maxTokens: 8192, supportsTools: true },
    'gpt-5-nano': { maxTokens: 2048, supportsTools: true },
    'gpt-5-mini': { maxTokens: 4096, supportsTools: true },
    'gpt-5.1': { maxTokens: 16384, supportsTools: true, reasoningLevel: true },
    'gpt-5.2': { maxTokens: 32768, supportsTools: true, reasoningLevel: true },
    'o1': { maxTokens: 65536, supportsTools: false, reasoningLevel: true },
    'o1-mini': { maxTokens: 65536, supportsTools: false, reasoningLevel: true },
    'o3': { maxTokens: 100000, supportsTools: true, reasoningLevel: true },
    'o3-mini': { maxTokens: 65536, supportsTools: true, reasoningLevel: true },
};

