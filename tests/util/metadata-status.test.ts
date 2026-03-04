import { describe, expect, it } from 'vitest';
import { VALID_STATUSES, isValidStatus, updateStatus } from '../../src/util/metadata';

describe('metadata status utilities', () => {
    it('includes deleted in valid statuses', () => {
        expect(VALID_STATUSES).toContain('deleted');
        expect(isValidStatus('deleted')).toBe(true);
    });

    it('rejects unknown statuses', () => {
        expect(isValidStatus('permanently_deleted')).toBe(false);
    });

    it('records transition when setting deleted', () => {
        const updated = updateStatus(
            {
                status: 'reviewed',
                history: [],
            },
            'deleted'
        );

        expect(updated.status).toBe('deleted');
        expect(updated.history).toHaveLength(1);
        expect(updated.history?.[0]).toMatchObject({
            from: 'reviewed',
            to: 'deleted',
        });
        expect(typeof updated.history?.[0].at).toBe('string');
    });

    it('does not append duplicate history when status unchanged', () => {
        const initial = {
            status: 'deleted' as const,
            history: [{ from: 'reviewed', to: 'deleted', at: '2026-03-04T10:00:00.000Z' }],
        };

        const updated = updateStatus(initial, 'deleted');
        expect(updated).toBe(initial);
        expect(updated.history).toHaveLength(1);
    });
});
