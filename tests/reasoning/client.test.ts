import { describe, it, expect } from 'vitest';
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

