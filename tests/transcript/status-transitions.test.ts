import { describe, expect, it } from 'vitest';
import { isValidStatusTransition } from '../../src/transcript/operations';

describe('isValidStatusTransition with deleted status', () => {
    it('allows closing flows to deleted', () => {
        expect(isValidStatusTransition('closed', 'deleted')).toBe(true);
        expect(isValidStatusTransition('archived', 'deleted')).toBe(true);
    });

    it('allows restoring from deleted', () => {
        expect(isValidStatusTransition('deleted', 'archived')).toBe(true);
        expect(isValidStatusTransition('deleted', 'closed')).toBe(true);
    });

    it('rejects invalid jumps from deleted', () => {
        expect(isValidStatusTransition('deleted', 'enhanced')).toBe(false);
        expect(isValidStatusTransition('deleted', 'reviewed')).toBe(false);
    });
});
