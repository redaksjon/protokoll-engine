/**
 * Reasoning Client
 * 
 * Wrapper for reasoning model calls with tool/function calling support.
 * Uses OpenAI's native function calling for agentic workflows.
 */

import OpenAI from 'openai';
import { ReasoningConfig, ReasoningRequest, ReasoningResponse, ToolCall } from './types';
import * as Logging from '../logging';

export interface ToolCallRequest {
    messages: Array<{
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }>;
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
}

export interface ToolCallResponse {
    content: string;
    tool_calls?: Array<{
        id: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
    finish_reason?: string;
}

export interface ClientInstance {
    complete(request: ReasoningRequest): Promise<ReasoningResponse>;
    completeWithTools(request: ToolCallRequest): Promise<ToolCallResponse>;
    isReasoningModel(model: string): boolean;
    getModelFamily(model: string): 'openai' | 'anthropic' | 'gemini' | 'unknown';
}

export const create = (config: ReasoningConfig): ClientInstance => {
    const logger = Logging.getLogger();
    
    // Lazy-initialize OpenAI client (only when actually needed)
    let client: OpenAI | null = null;
    const getClient = (): OpenAI => {
        if (!client) {
            client = new OpenAI({ apiKey: config.apiKey });
        }
        return client;
    };
  
    const getModelFamily = (model: string): 'openai' | 'anthropic' | 'gemini' | 'unknown' => {
        if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
        if (model.startsWith('claude')) return 'anthropic';
        if (model.startsWith('gemini')) return 'gemini';
        return 'unknown';
    };
  
    const isReasoningModel = (model: string): boolean => {
        // Models known for strong reasoning
        const reasoningModels = [
            'gpt-4o', 'gpt-4-turbo', 'gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.2',
            'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini',
            'claude-3-5-sonnet', 'claude-3-opus', 'claude-4',
        ];
        return reasoningModels.some(rm => model.includes(rm));
    };
    
    const supportsReasoningLevel = (model: string): boolean => {
        // Models that support reasoning_effort parameter
        const models = ['gpt-5.1', 'gpt-5.2', 'o1', 'o1-mini', 'o3', 'o3-mini'];
        return models.some(m => model.includes(m));
    };
  
    const complete = async (request: ReasoningRequest): Promise<ReasoningResponse> => {
        const startTime = Date.now();
        logger.debug('Reasoning request starting', { model: config.model });
    
        try {
            // Build messages for OpenAI
            const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = [];
      
            if (request.systemPrompt) {
                messages.push({ role: 'system', content: request.systemPrompt });
            }
      
            // Add the main prompt
            messages.push({ role: 'user', content: request.prompt });
      
            // Build tools if provided
            const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = request.tools?.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
      
            // Build request options
            const requestOptions: Record<string, unknown> = {
                model: config.model,
                messages,
                tools: tools && tools.length > 0 ? tools : undefined,
                tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
            };
            
            // Add reasoning_effort for models that support it (default to 'medium')
            if (supportsReasoningLevel(config.model)) {
                const reasoningLevel = config.reasoningLevel || 'medium';
                requestOptions.reasoning_effort = reasoningLevel;
                logger.debug('Using reasoning_effort: %s for model %s', reasoningLevel, config.model);
            }
            
            const response = await getClient().chat.completions.create(
                requestOptions as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
            );
      
            const duration = Date.now() - startTime;
            logger.debug('Reasoning model responded in %dms', duration);
      
            const choice = response.choices[0];
            const message = choice.message;
      
            // Extract token usage
            const usage = response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined;
      
            // Extract tool calls if any
            const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(tc => {
                // Handle both standard and custom tool call formats
                const fn = 'function' in tc ? tc.function : null;
                if (!fn) {
                    return { id: tc.id, name: 'unknown', arguments: {} };
                }
                return {
                    id: tc.id,
                    name: fn.name,
                    arguments: JSON.parse(fn.arguments),
                };
            });
      
            if (toolCalls && toolCalls.length > 0) {
                logger.debug('Model requested %d tool calls: %s', toolCalls.length, toolCalls.map(t => t.name).join(', '));
            }
      
            return {
                content: message.content || '',
                model: config.model,
                duration,
                usage,
                toolCalls,
                finishReason: choice.finish_reason,
            };
        } catch (error) {
            logger.error('Reasoning request failed', { error });
            throw error;
        }
    };
  
    const completeWithTools = async (request: ToolCallRequest): Promise<ToolCallResponse> => {
        logger.debug('Tool call request starting', { model: config.model, messageCount: request.messages.length });
        
        try {
            // Convert messages to OpenAI format
            const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = request.messages.map(msg => {
                if (msg.role === 'tool') {
                    return {
                        role: 'tool' as const,
                        content: msg.content,
                        tool_call_id: msg.tool_call_id || '',
                    };
                }
                if (msg.role === 'assistant' && msg.tool_calls) {
                    return {
                        role: 'assistant' as const,
                        content: msg.content || null,
                        tool_calls: msg.tool_calls.map(tc => ({
                            id: tc.id,
                            type: 'function' as const,
                            function: tc.function,
                        })),
                    };
                }
                return {
                    role: msg.role as 'system' | 'user' | 'assistant',
                    content: msg.content,
                };
            });
            
            // Build request options
            const requestOptions: Record<string, unknown> = {
                model: config.model,
                messages,
                tools: request.tools,
                tool_choice: request.tools && request.tools.length > 0 ? 'auto' : undefined,
            };
            
            // Add reasoning_effort for models that support it
            if (supportsReasoningLevel(config.model)) {
                requestOptions.reasoning_effort = config.reasoningLevel || 'medium';
            }
            
            const response = await getClient().chat.completions.create(
                requestOptions as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
            );
            
            const choice = response.choices[0];
            const message = choice.message;
            
            // Extract tool calls if any
            const toolCalls = message.tool_calls?.map(tc => {
                // Handle both standard and custom tool call formats
                const fn = 'function' in tc ? tc.function : null;
                if (!fn) {
                    return { id: tc.id, function: { name: 'unknown', arguments: '{}' } };
                }
                return {
                    id: tc.id,
                    function: {
                        name: fn.name,
                        arguments: fn.arguments,
                    },
                };
            });
            
            if (toolCalls && toolCalls.length > 0) {
                logger.debug('Model requested %d tool calls: %s', toolCalls.length, toolCalls.map(t => t.function.name).join(', '));
            }
            
            return {
                content: message.content || '',
                tool_calls: toolCalls,
                finish_reason: choice.finish_reason,
            };
        } catch (error) {
            logger.error('Tool call request failed', { error });
            throw error;
        }
    };
    
    return {
        complete,
        completeWithTools,
        isReasoningModel,
        getModelFamily,
    };
};
