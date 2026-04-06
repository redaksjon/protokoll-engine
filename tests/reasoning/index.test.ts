/**
 * Tests for Reasoning System Factory (reasoning/index.ts)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the client module
vi.mock('../../src/reasoning/client', () => ({
    create: vi.fn(() => ({
        complete: vi.fn().mockResolvedValue({
            content: 'test response',
            model: 'gpt-4o',
            duration: 100,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
        completeWithTools: vi.fn(),
        isReasoningModel: vi.fn((m: string) => m.includes('gpt-4')),
        getModelFamily: vi.fn((m: string) => m.startsWith('gpt') ? 'openai' : 'unknown'),
    })),
}));

// Mock the strategy module
vi.mock('../../src/reasoning/strategy', () => ({
    createStrategy: vi.fn(() => ({})),
    getRecommendedStrategy: vi.fn(() => 'simple'),
}));

describe('Reasoning System Factory', () => {
    it('should create a reasoning instance', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        expect(instance).toBeDefined();
        expect(typeof instance.complete).toBe('function');
        expect(typeof instance.completeWithTools).toBe('function');
        expect(typeof instance.executeWithStrategy).toBe('function');
        expect(typeof instance.isReasoningModel).toBe('function');
        expect(typeof instance.getModelFamily).toBe('function');
        expect(typeof instance.getRecommendedStrategy).toBe('function');
    });

    it('should delegate complete to client', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        const result = await instance.complete({ prompt: 'test' });
        expect(result.content).toBe('test response');
        expect(result.model).toBe('gpt-4o');
    });

    it('should execute with strategy and return metrics', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        const result = await instance.executeWithStrategy(
            { prompt: 'test' },
            'simple'
        );
        expect(result.content).toBe('test response');
        expect(result.metrics).toBeDefined();
        expect(result.metrics.iterations).toBe(1);
        expect(result.metrics.totalDuration).toBe(100);
        expect(result.metrics.tokensUsed).toBe(30);
    });

    it('should handle executeWithStrategy with no tool calls', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        const result = await instance.executeWithStrategy(
            { prompt: 'test' },
            'adaptive'
        );
        expect(result.metrics.toolCallsExecuted).toBe(0);
    });

    it('should delegate isReasoningModel to client', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        expect(instance.isReasoningModel('gpt-4o')).toBe(true);
    });

    it('should delegate getModelFamily to client', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        expect(instance.getModelFamily('gpt-4o')).toBe('openai');
    });

    it('should delegate getRecommendedStrategy to strategy', async () => {
        const { create } = await import('../../src/reasoning');
        const instance = create({ model: 'gpt-4o' });
        expect(instance.getRecommendedStrategy(200, false, 'low')).toBe('simple');
    });
});
