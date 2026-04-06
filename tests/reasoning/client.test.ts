import { describe, it, expect, vi, beforeEach } from 'vitest';
import { REASONING_MODELS } from '../../src/reasoning/types';
import { getRecommendedStrategy } from '../../src/reasoning/strategy';

// Test the types and strategy functions that don't require API calls
describe('Reasoning Types', () => {
    describe('REASONING_MODELS', () => {
        it('should define settings for common models', () => {
            expect(REASONING_MODELS['claude-3-5-sonnet']).toBeDefined();
            expect(REASONING_MODELS['gpt-4o']).toBeDefined();
            expect(REASONING_MODELS['o1']).toBeDefined();
        });
    
        it('should indicate tool support correctly', () => {
            expect(REASONING_MODELS['claude-3-5-sonnet'].supportsTools).toBe(true);
            expect(REASONING_MODELS['gpt-4o'].supportsTools).toBe(true);
            expect(REASONING_MODELS['o1'].supportsTools).toBe(false);
        });
    
        it('should indicate reasoning level support for o1 models', () => {
            expect(REASONING_MODELS['o1'].reasoningLevel).toBe(true);
            expect(REASONING_MODELS['o1-mini'].reasoningLevel).toBe(true);
            expect(REASONING_MODELS['gpt-4o'].reasoningLevel).toBeUndefined();
        });
    });
});

describe('Reasoning Strategy', () => {
    describe('getRecommendedStrategy', () => {
        it('should recommend simple for short, simple transcripts', () => {
            const strategy = getRecommendedStrategy(200, false, 'low');
            expect(strategy).toBe('simple');
        });
    
        it('should recommend investigate-then-respond for unknown names', () => {
            const strategy = getRecommendedStrategy(500, true, 'medium');
            expect(strategy).toBe('investigate-then-respond');
        });
    
        it('should recommend investigate-then-respond for high complexity', () => {
            const strategy = getRecommendedStrategy(1000, false, 'high');
            expect(strategy).toBe('investigate-then-respond');
        });
    
        it('should recommend adaptive for medium complexity without unknowns', () => {
            const strategy = getRecommendedStrategy(800, false, 'medium');
            expect(strategy).toBe('adaptive');
        });
    
        it('should recommend adaptive for long transcripts with low complexity', () => {
            const strategy = getRecommendedStrategy(2000, false, 'low');
            expect(strategy).toBe('adaptive');
        });
    });
});

describe('Reasoning Module Exports', () => {
    it('should export create function', async () => {
        const Reasoning = await import('../../src/reasoning');
        expect(Reasoning.create).toBeDefined();
        expect(typeof Reasoning.create).toBe('function');
    });
  
    it('should export strategy types', async () => {
        const Strategy = await import('../../src/reasoning/strategy');
        expect(Strategy.getRecommendedStrategy).toBeDefined();
        expect(Strategy.createStrategy).toBeDefined();
    });
  
    it('should export types', async () => {
        const Types = await import('../../src/reasoning/types');
        expect(Types.REASONING_MODELS).toBeDefined();
    });
});

// ============================================================================
// Tests for the create() factory in client.ts
// ============================================================================

// Mock OpenAI
const mockCreate = vi.fn();
const mockChatCompletions = {
    create: mockCreate,
};
const MockOpenAIConstructor = vi.fn().mockImplementation(() => ({
    chat: { completions: mockChatCompletions },
}));

vi.mock('openai', () => ({
    default: MockOpenAIConstructor,
}));

// Mock logging
vi.mock('../../src/logging', () => ({
    getLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Import the client factory
const { create: createClient } = await import('../../src/reasoning/client');

describe('Reasoning Client Factory', () => {
    let client: ReturnType<typeof createClient>;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createClient({ model: 'gpt-4o', apiKey: 'test-key' });
    });

    describe('getModelFamily', () => {
        it('should return "openai" for gpt models', () => {
            expect(client.getModelFamily('gpt-4o')).toBe('openai');
            expect(client.getModelFamily('gpt-4-turbo')).toBe('openai');
            expect(client.getModelFamily('gpt-5')).toBe('openai');
            expect(client.getModelFamily('gpt-5-mini')).toBe('openai');
        });

        it('should return "openai" for o1 models', () => {
            expect(client.getModelFamily('o1')).toBe('openai');
            expect(client.getModelFamily('o1-mini')).toBe('openai');
            expect(client.getModelFamily('o1-preview')).toBe('openai');
        });

        it('should return "openai" for o3 models', () => {
            expect(client.getModelFamily('o3')).toBe('openai');
            expect(client.getModelFamily('o3-mini')).toBe('openai');
        });

        it('should return "anthropic" for claude models', () => {
            expect(client.getModelFamily('claude-3-5-sonnet')).toBe('anthropic');
            expect(client.getModelFamily('claude-3-opus')).toBe('anthropic');
            expect(client.getModelFamily('claude-4')).toBe('anthropic');
        });

        it('should return "gemini" for gemini models', () => {
            expect(client.getModelFamily('gemini-pro')).toBe('gemini');
            expect(client.getModelFamily('gemini-1.5-flash')).toBe('gemini');
        });

        it('should return "unknown" for unrecognized models', () => {
            expect(client.getModelFamily('llama-3')).toBe('unknown');
            expect(client.getModelFamily('mistral-7b')).toBe('unknown');
            expect(client.getModelFamily('')).toBe('unknown');
        });
    });

    describe('isReasoningModel', () => {
        it('should return true for known GPT reasoning models', () => {
            expect(client.isReasoningModel('gpt-4o')).toBe(true);
            expect(client.isReasoningModel('gpt-4-turbo')).toBe(true);
            expect(client.isReasoningModel('gpt-5')).toBe(true);
            expect(client.isReasoningModel('gpt-5-mini')).toBe(true);
            expect(client.isReasoningModel('gpt-5.1')).toBe(true);
            expect(client.isReasoningModel('gpt-5.2')).toBe(true);
        });

        it('should return true for known o1/o3 models', () => {
            expect(client.isReasoningModel('o1')).toBe(true);
            expect(client.isReasoningModel('o1-mini')).toBe(true);
            expect(client.isReasoningModel('o1-preview')).toBe(true);
            expect(client.isReasoningModel('o3')).toBe(true);
            expect(client.isReasoningModel('o3-mini')).toBe(true);
        });

        it('should return true for known Claude models', () => {
            expect(client.isReasoningModel('claude-3-5-sonnet')).toBe(true);
            expect(client.isReasoningModel('claude-3-opus')).toBe(true);
            expect(client.isReasoningModel('claude-4')).toBe(true);
        });

        it('should return false for unknown models', () => {
            expect(client.isReasoningModel('gpt-3.5-turbo')).toBe(false);
            expect(client.isReasoningModel('llama-3')).toBe(false);
            expect(client.isReasoningModel('unknown-model')).toBe(false);
        });
    });

    describe('complete', () => {
        it('should make a basic completion request', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Hello world', role: 'assistant' },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            });

            const result = await client.complete({ prompt: 'Say hello' });

            expect(result.content).toBe('Hello world');
            expect(result.model).toBe('gpt-4o');
            expect(result.usage).toEqual({
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            });
            expect(result.finishReason).toBe('stop');
            expect(result.duration).toBeGreaterThanOrEqual(0);

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o',
                    messages: expect.arrayContaining([
                        { role: 'user', content: 'Say hello' },
                    ]),
                })
            );
        });

        it('should include system prompt when provided', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.complete({
                prompt: 'Test',
                systemPrompt: 'You are a helpful assistant.',
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: 'Test' },
                    ],
                })
            );
        });

        it('should not include system prompt when not provided', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.complete({ prompt: 'Test' });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        { role: 'user', content: 'Test' },
                    ],
                })
            );
        });

        it('should include tools when provided', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: '', role: 'assistant' },
                    finish_reason: 'tool_calls',
                }],
            });

            const tools = [
                {
                    name: 'lookup_person',
                    description: 'Look up a person',
                    parameters: { type: 'object', properties: { name: { type: 'string' } } },
                },
            ];

            await client.complete({ prompt: 'Test', tools });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: [{
                        type: 'function',
                        function: {
                            name: 'lookup_person',
                            description: 'Look up a person',
                            parameters: { type: 'object', properties: { name: { type: 'string' } } },
                        },
                    }],
                    tool_choice: 'auto',
                })
            );
        });

        it('should not include tools when empty array', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.complete({ prompt: 'Test', tools: [] });

            const callArgs = mockCreate.mock.calls[0][0];
            expect(callArgs.tools).toBeUndefined();
            expect(callArgs.tool_choice).toBeUndefined();
        });

        it('should extract tool calls from response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: '',
                        role: 'assistant',
                        tool_calls: [{
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'lookup_person',
                                arguments: '{"name": "John"}',
                            },
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
            });

            const result = await client.complete({ prompt: 'Test' });

            expect(result.toolCalls).toEqual([{
                id: 'call_123',
                name: 'lookup_person',
                arguments: { name: 'John' },
            }]);
        });

        it('should handle tool calls without function property', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: '',
                        role: 'assistant',
                        tool_calls: [{
                            id: 'call_456',
                            type: 'function',
                            // No 'function' property
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
            });

            const result = await client.complete({ prompt: 'Test' });

            expect(result.toolCalls).toEqual([{
                id: 'call_456',
                name: 'unknown',
                arguments: {},
            }]);
        });

        it('should add reasoning_effort for supported models', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const o1Client = createClient({ model: 'o1', apiKey: 'test-key' });
            await o1Client.complete({ prompt: 'Test' });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    reasoning_effort: 'medium',
                })
            );
        });

        it('should use custom reasoning level when configured', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const o1Client = createClient({ model: 'o1', apiKey: 'test-key', reasoningLevel: 'high' });
            await o1Client.complete({ prompt: 'Test' });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    reasoning_effort: 'high',
                })
            );
        });

        it('should not add reasoning_effort for non-supported models', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.complete({ prompt: 'Test' });

            const callArgs = mockCreate.mock.calls[0][0];
            expect(callArgs.reasoning_effort).toBeUndefined();
        });

        it('should handle null content in response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: null, role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const result = await client.complete({ prompt: 'Test' });
            expect(result.content).toBe('');
        });

        it('should handle missing usage', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const result = await client.complete({ prompt: 'Test' });
            expect(result.usage).toBeUndefined();
        });

        it('should throw and log on API error', async () => {
            mockCreate.mockRejectedValue(new Error('API rate limit'));

            await expect(client.complete({ prompt: 'Test' })).rejects.toThrow('API rate limit');
        });

        it('should lazy-initialize OpenAI client', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            // Client was created but OpenAI constructor should not have been called yet
            expect(MockOpenAIConstructor).not.toHaveBeenCalled();

            await client.complete({ prompt: 'Test' });

            // Now it should have been called
            expect(MockOpenAIConstructor).toHaveBeenCalledWith({ apiKey: 'test-key' });
        });
    });

    describe('completeWithTools', () => {
        it('should make a tool call request with messages', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Result', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const result = await client.completeWithTools({
                messages: [
                    { role: 'system', content: 'System prompt' },
                    { role: 'user', content: 'User message' },
                ],
            });

            expect(result.content).toBe('Result');
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'System prompt' },
                        { role: 'user', content: 'User message' },
                    ],
                })
            );
        });

        it('should convert tool role messages correctly', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.completeWithTools({
                messages: [
                    { role: 'tool', content: 'tool result', tool_call_id: 'call_123' },
                ],
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        { role: 'tool', content: 'tool result', tool_call_id: 'call_123' },
                    ],
                })
            );
        });

        it('should convert assistant messages with tool calls', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.completeWithTools({
                messages: [
                    {
                        role: 'assistant',
                        content: 'Let me look that up',
                        tool_calls: [{
                            id: 'call_123',
                            function: { name: 'lookup', arguments: '{"q": "test"}' },
                        }],
                    },
                ],
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        {
                            role: 'assistant',
                            content: 'Let me look that up',
                            tool_calls: [{
                                id: 'call_123',
                                type: 'function',
                                function: { name: 'lookup', arguments: '{"q": "test"}' },
                            }],
                        },
                    ],
                })
            );
        });

        it('should extract tool calls from response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: '',
                        role: 'assistant',
                        tool_calls: [{
                            id: 'call_abc',
                            type: 'function',
                            function: {
                                name: 'route_note',
                                arguments: '{"destination": "/notes"}',
                            },
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
            });

            const result = await client.completeWithTools({
                messages: [{ role: 'user', content: 'Route this note' }],
            });

            expect(result.tool_calls).toEqual([{
                id: 'call_abc',
                function: {
                    name: 'route_note',
                    arguments: '{"destination": "/notes"}',
                },
            }]);
            expect(result.finish_reason).toBe('tool_calls');
        });

        it('should handle tool calls without function property', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: {
                        content: '',
                        role: 'assistant',
                        tool_calls: [{
                            id: 'call_no_fn',
                            type: 'function',
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
            });

            const result = await client.completeWithTools({
                messages: [{ role: 'user', content: 'Test' }],
            });

            expect(result.tool_calls).toEqual([{
                id: 'call_no_fn',
                function: { name: 'unknown', arguments: '{}' },
            }]);
        });

        it('should include tools and tool_choice when tools provided', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const tools = [{
                type: 'function' as const,
                function: { name: 'test_tool', description: 'A test', parameters: {} },
            }];

            await client.completeWithTools({
                messages: [{ role: 'user', content: 'Test' }],
                tools,
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools,
                    tool_choice: 'auto',
                })
            );
        });

        it('should add reasoning_effort for supported models', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const o3Client = createClient({ model: 'o3', apiKey: 'test-key' });
            await o3Client.completeWithTools({
                messages: [{ role: 'user', content: 'Test' }],
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    reasoning_effort: 'medium',
                })
            );
        });

        it('should handle null content in response', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: null, role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            const result = await client.completeWithTools({
                messages: [{ role: 'user', content: 'Test' }],
            });
            expect(result.content).toBe('');
        });

        it('should throw and log on API error', async () => {
            mockCreate.mockRejectedValue(new Error('Network error'));

            await expect(
                client.completeWithTools({ messages: [{ role: 'user', content: 'Test' }] })
            ).rejects.toThrow('Network error');
        });

        it('should handle tool message without tool_call_id', async () => {
            mockCreate.mockResolvedValue({
                choices: [{
                    message: { content: 'Response', role: 'assistant' },
                    finish_reason: 'stop',
                }],
            });

            await client.completeWithTools({
                messages: [
                    { role: 'tool', content: 'result' },
                ],
            });

            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        { role: 'tool', content: 'result', tool_call_id: '' },
                    ],
                })
            );
        });
    });
});
