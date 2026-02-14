/**
 * Tests for Feedback Analyzer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logging
vi.mock('../../src/logging', () => ({
    getLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Mock reasoning
const mockReasoning = {
    complete: vi.fn(),
};

vi.mock('../../src/reasoning', () => ({
    create: vi.fn(() => mockReasoning),
}));

// Mock context
const mockContext = {
    getAllProjects: vi.fn(() => []),
    getProject: vi.fn(() => null),
    saveEntity: vi.fn(),
};

// Import after mocking
const { create } = await import('../../src/feedback/analyzer');

describe('Feedback Analyzer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockContext.getAllProjects.mockReturnValue([
            {
                id: 'existing-project',
                name: 'Existing Project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['existing'],
                    topics: [],
                },
                routing: {
                    destination: '~/notes/existing',
                },
            },
        ]);
    });

    describe('analyze', () => {
        it('should analyze feedback and return suggestions', async () => {
            mockReasoning.complete.mockResolvedValue({
                content: JSON.stringify({
                    diagnosis: 'Missing trigger phrase for Project Alpha',
                    suggestedUpdates: [
                        {
                            type: 'new_project',
                            entityType: 'project',
                            entityId: 'project-alpha',
                            changes: [
                                { field: 'name', newValue: 'Project Alpha' },
                                { field: 'destination', newValue: '~/notes/projects/alpha' },
                                { field: 'explicit_phrases', newValue: ['project alpha', 'update on alpha'] },
                            ],
                            reasoning: 'User indicated this is a new project',
                            confidence: 0.9,
                        },
                    ],
                    confidence: 0.85,
                }),
            });

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.8,
            });

            const feedback = {
                transcriptPath: '/test/transcript.md',
                originalDecision: {
                    projectId: null,
                    destination: '~/notes',
                    confidence: 1.0,
                    reasoning: 'No project matches found',
                },
                correction: {
                    projectId: 'project-alpha',
                    destination: '~/notes/projects/alpha',
                },
                userReason: 'This was about Project Alpha',
                providedAt: new Date(),
            };

            const analysis = await analyzer.analyze(feedback);

            expect(analysis.diagnosis).toBe('Missing trigger phrase for Project Alpha');
            expect(analysis.suggestedUpdates.length).toBe(1);
            expect(analysis.suggestedUpdates[0].entityId).toBe('project-alpha');
            expect(analysis.confidence).toBe(0.85);
        });

        it('should return basic analysis on reasoning failure', async () => {
            mockReasoning.complete.mockRejectedValue(new Error('API error'));

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.8,
            });

            const feedback = {
                transcriptPath: '/test/transcript.md',
                originalDecision: {
                    projectId: null,
                    destination: '~/notes',
                    confidence: 1.0,
                    reasoning: 'Default',
                },
                correction: {},
                userReason: 'Test',
                providedAt: new Date(),
            };

            const analysis = await analyzer.analyze(feedback);

            expect(analysis.diagnosis).toContain('Unable to analyze');
            expect(analysis.suggestedUpdates).toEqual([]);
            expect(analysis.confidence).toBe(0);
        });
    });

    describe('applyUpdates', () => {
        it('should apply new project updates', async () => {
            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_project' as const,
                    entityType: 'project' as const,
                    entityId: 'project-alpha',
                    changes: [
                        { field: 'name', newValue: 'Project Alpha' },
                        { field: 'destination', newValue: '~/notes/projects/alpha' },
                        { field: 'explicit_phrases', newValue: ['project alpha'] },
                    ],
                    reasoning: 'New project',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.id).toBe('project-alpha');
            expect(savedEntity.type).toBe('project');
        });

        it('should skip low-confidence updates', async () => {
            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.8,
            });

            const updates = [
                {
                    type: 'new_project' as const,
                    entityType: 'project' as const,
                    entityId: 'low-confidence',
                    changes: [],
                    reasoning: 'Low confidence update',
                    confidence: 0.5, // Below threshold
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).not.toHaveBeenCalled();
        });

        it('should apply phrase updates to existing projects', async () => {
            mockContext.getProject.mockReturnValue({
                id: 'existing-project',
                name: 'Existing Project',
                type: 'project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['existing'],
                    topics: [],
                },
                routing: {
                    destination: '~/notes/existing',
                    structure: 'month',
                    filename_options: ['date', 'time', 'subject'],
                },
            });

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_phrase' as const,
                    entityType: 'project' as const,
                    entityId: 'existing-project',
                    changes: [
                        { field: 'explicit_phrases', newValue: ['new phrase'] },
                    ],
                    reasoning: 'Add new trigger phrase',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.classification.explicit_phrases).toContain('existing');
            expect(savedEntity.classification.explicit_phrases).toContain('new phrase');
        });

        it('should handle missing project for update gracefully', async () => {
            mockContext.getProject.mockReturnValue(null);

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_phrase' as const,
                    entityType: 'project' as const,
                    entityId: 'nonexistent',
                    changes: [],
                    reasoning: 'Update nonexistent',
                    confidence: 0.9,
                },
            ];

            // Should not throw
            await analyzer.applyUpdates(updates);
            expect(mockContext.saveEntity).not.toHaveBeenCalled();
        });

        it('should apply context_type to new project', async () => {
            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_project' as const,
                    entityType: 'project' as const,
                    entityId: 'personal-project',
                    changes: [
                        { field: 'name', newValue: 'Personal Project' },
                        { field: 'context_type', newValue: 'personal' },
                    ],
                    reasoning: 'Personal project',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.classification.context_type).toBe('personal');
        });

        it('should apply topics to new project', async () => {
            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_project' as const,
                    entityType: 'project' as const,
                    entityId: 'topic-project',
                    changes: [
                        { field: 'name', newValue: 'Topic Project' },
                        { field: 'topics', newValue: ['ai', 'ml', 'data'] },
                    ],
                    reasoning: 'Project with topics',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.classification.topics).toEqual(['ai', 'ml', 'data']);
        });

        it('should apply topic updates to existing projects', async () => {
            mockContext.getProject.mockReturnValue({
                id: 'existing-project',
                name: 'Existing Project',
                type: 'project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['existing'],
                    topics: ['original-topic'],
                },
                routing: {
                    destination: '~/notes/existing',
                    structure: 'month',
                    filename_options: ['date', 'time', 'subject'],
                },
            });

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_topic' as const,
                    entityType: 'project' as const,
                    entityId: 'existing-project',
                    changes: [
                        { field: 'topics', newValue: ['new-topic', 'another-topic'] },
                    ],
                    reasoning: 'Add new topics',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.classification.topics).toContain('original-topic');
            expect(savedEntity.classification.topics).toContain('new-topic');
            expect(savedEntity.classification.topics).toContain('another-topic');
        });

        it('should apply context_type updates to existing projects', async () => {
            mockContext.getProject.mockReturnValue({
                id: 'existing-project',
                name: 'Existing Project',
                type: 'project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['existing'],
                    topics: [],
                },
                routing: {
                    destination: '~/notes/existing',
                    structure: 'month',
                    filename_options: ['date', 'time', 'subject'],
                },
            });

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'context_type' as const,
                    entityType: 'project' as const,
                    entityId: 'existing-project',
                    changes: [
                        { field: 'context_type', newValue: 'mixed' },
                    ],
                    reasoning: 'Change to mixed context',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            expect(mockContext.saveEntity).toHaveBeenCalled();
            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            expect(savedEntity.classification.context_type).toBe('mixed');
        });

        it('should handle errors when saving entity fails', async () => {
            mockContext.saveEntity.mockRejectedValue(new Error('Save failed'));

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_project' as const,
                    entityType: 'project' as const,
                    entityId: 'error-project',
                    changes: [
                        { field: 'name', newValue: 'Error Project' },
                    ],
                    reasoning: 'Will fail',
                    confidence: 0.9,
                },
            ];

            // Should not throw
            await analyzer.applyUpdates(updates);
            expect(mockContext.saveEntity).toHaveBeenCalled();
        });

        it('should not duplicate existing phrases when adding new ones', async () => {
            mockContext.getProject.mockReturnValue({
                id: 'existing-project',
                name: 'Existing Project',
                type: 'project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['phrase-one', 'phrase-two'],
                    topics: [],
                },
                routing: {
                    destination: '~/notes/existing',
                    structure: 'month',
                    filename_options: ['date', 'time', 'subject'],
                },
            });

            // @ts-ignore - mock context
            const analyzer = create(mockReasoning, mockContext, {
                model: 'gpt-5.2',
                autoApplyThreshold: 0.5,
            });

            const updates = [
                {
                    type: 'new_phrase' as const,
                    entityType: 'project' as const,
                    entityId: 'existing-project',
                    changes: [
                        { field: 'explicit_phrases', newValue: ['phrase-two', 'phrase-three'] }, // phrase-two already exists
                    ],
                    reasoning: 'Add new phrase',
                    confidence: 0.9,
                },
            ];

            await analyzer.applyUpdates(updates);

            const savedEntity = mockContext.saveEntity.mock.calls[0][0];
            const phrases = savedEntity.classification.explicit_phrases;
            // Should have 3 phrases, not 4 (no duplicate)
            expect(phrases.filter((p: string) => p === 'phrase-two').length).toBe(1);
            expect(phrases).toContain('phrase-one');
            expect(phrases).toContain('phrase-two');
            expect(phrases).toContain('phrase-three');
        });
    });
});

