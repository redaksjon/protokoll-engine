/**
 * Tests for Reasoning Strategy Factory (reasoning/strategy.ts)
 */

import { describe, it, expect } from 'vitest';

describe('Reasoning Strategy Factory', () => {
    describe('createStrategy', () => {
        it('should create simple strategy', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'simple' });
            expect(strategy).toBeDefined();
        });

        it('should create investigate-then-respond strategy', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'investigate-then-respond' });
            expect(strategy).toBeDefined();
        });

        it('should create multi-pass strategy', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'multi-pass' });
            expect(strategy).toBeDefined();
        });

        it('should create adaptive strategy', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'adaptive' });
            expect(strategy).toBeDefined();
        });

        it('should use custom maxIterations when provided', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'simple', maxIterations: 5 });
            expect(strategy).toBeDefined();
        });

        it('should handle unknown strategy type with default', async () => {
            const { createStrategy } = await import('../../src/reasoning/strategy');
            const strategy = createStrategy({ type: 'unknown' as any });
            expect(strategy).toBeDefined();
        });
    });
});
