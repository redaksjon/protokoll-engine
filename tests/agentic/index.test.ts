/**
 * Tests for Agentic System Factory (agentic/index.ts)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock executor
vi.mock('../../src/agentic/executor', () => ({
    create: vi.fn(() => ({
        process: vi.fn().mockResolvedValue({
            enhancedText: 'enhanced transcript',
            state: 'enhanced',
            toolsUsed: ['lookup_project'],
            iterations: 3,
            totalTokens: 500,
            contextChanges: [],
        }),
    })),
}));

// Mock registry
vi.mock('../../src/agentic/registry', () => ({
    create: vi.fn(() => ({
        getTools: vi.fn(() => [
            { name: 'lookup_project' },
            { name: 'lookup_person' },
            { name: 'route_note' },
        ]),
    })),
}));

describe('Agentic System Factory', () => {
    it('should create an agentic instance', async () => {
        const { create } = await import('../../src/agentic');
        const mockReasoning = {
            complete: vi.fn(),
            completeWithTools: vi.fn(),
            executeWithStrategy: vi.fn(),
            isReasoningModel: vi.fn(),
            getModelFamily: vi.fn(),
            getRecommendedStrategy: vi.fn(),
        };
        const mockToolContext = {
            projects: [],
            people: [],
            companies: [],
            terms: [],
        };

        const instance = create(mockReasoning as any, mockToolContext);
        expect(instance).toBeDefined();
        expect(typeof instance.process).toBe('function');
        expect(typeof instance.getAvailableTools).toBe('function');
    });

    it('should delegate process to executor', async () => {
        const { create } = await import('../../src/agentic');
        const mockReasoning = {
            complete: vi.fn(),
            completeWithTools: vi.fn(),
            executeWithStrategy: vi.fn(),
            isReasoningModel: vi.fn(),
            getModelFamily: vi.fn(),
            getRecommendedStrategy: vi.fn(),
        };
        const mockToolContext = {
            projects: [],
            people: [],
            companies: [],
            terms: [],
        };

        const instance = create(mockReasoning as any, mockToolContext);
        const result = await instance.process('raw transcript');
        expect(result.enhancedText).toBe('enhanced transcript');
        expect(result.state).toBe('enhanced');
        expect(result.toolsUsed).toEqual(['lookup_project']);
        expect(result.iterations).toBe(3);
        expect(result.totalTokens).toBe(500);
    });

    it('should return available tools from registry', async () => {
        const { create } = await import('../../src/agentic');
        const mockReasoning = {
            complete: vi.fn(),
            completeWithTools: vi.fn(),
            executeWithStrategy: vi.fn(),
            isReasoningModel: vi.fn(),
            getModelFamily: vi.fn(),
            getRecommendedStrategy: vi.fn(),
        };
        const mockToolContext = {
            projects: [],
            people: [],
            companies: [],
            terms: [],
        };

        const instance = create(mockReasoning as any, mockToolContext);
        const tools = instance.getAvailableTools();
        expect(tools).toEqual(['lookup_project', 'lookup_person', 'route_note']);
    });
});
