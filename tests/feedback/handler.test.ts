/**
 * Tests for Feedback Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ClassificationDecision, ClassificationFeedback, FeedbackAnalysis, LearningUpdate } from '../../src/feedback/types';

// Mock logging
const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../src/logging', () => ({
    getLogger: () => mockLogger,
}));

// Mock readline - configurable responses
let questionResponses: string[] = [];
let questionIndex = 0;

const mockRl = {
    question: vi.fn((q: string, cb: (answer: string) => void) => {
        const response = questionResponses[questionIndex] || '';
        questionIndex++;
        cb(response);
    }),
    close: vi.fn(),
};

vi.mock('readline', () => ({
    createInterface: vi.fn(() => mockRl),
}));

// Import after mocking
const { create } = await import('../../src/feedback/handler');

// Helper to set up question responses for a test
const setQuestionResponses = (...responses: string[]) => {
    questionResponses = responses;
    questionIndex = 0;
    mockRl.question.mockClear();
    mockRl.close.mockClear();
};

describe('Feedback Handler', () => {
    let tempDir: string;
    let mockAnalyzer: {
        analyze: ReturnType<typeof vi.fn>;
        applyUpdates: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protokoll-handler-test-'));
        
        mockAnalyzer = {
            analyze: vi.fn(),
            applyUpdates: vi.fn(),
        };
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true });
    });

    const createMockDecision = (overrides?: Partial<ClassificationDecision>): ClassificationDecision => ({
        id: 'dec-test',
        transcriptPreview: 'Test transcript content...',
        audioFile: '/test/audio.m4a',
        projectId: null,
        destination: '~/notes',
        confidence: 0.5,
        timestamp: new Date(),
        reasoningTrace: {
            signalsDetected: [],
            projectsConsidered: [],
            finalReasoning: 'Default routing',
        },
        ...overrides,
    });

    describe('create', () => {
        it('should create a handler instance', () => {
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false,
            });

            expect(handler).toBeDefined();
            expect(handler.collectFeedback).toBeDefined();
            expect(handler.processFeedback).toBeDefined();
            expect(handler.reviewAndApply).toBeDefined();
            expect(handler.saveFeedback).toBeDefined();
        });
    });

    describe('collectFeedback', () => {
        it('should return null in non-interactive mode', async () => {
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false, // Not interactive
            });

            const result = await handler.collectFeedback(createMockDecision());

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should return null when user confirms correct classification (y)', async () => {
            setQuestionResponses('y');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const result = await handler.collectFeedback(createMockDecision());

            expect(result).toBeNull();
            expect(mockRl.close).toHaveBeenCalled();
        });

        it('should return null when user confirms correct classification (yes)', async () => {
            setQuestionResponses('yes');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const result = await handler.collectFeedback(createMockDecision());

            expect(result).toBeNull();
        });

        it('should collect feedback when user says classification was wrong', async () => {
            // Responses: wasCorrect, correctProject, correctDestination, topics, contextType, userReason
            setQuestionResponses('n', 'project-alpha', '/notes/alpha', 'ai,ml', 'work', 'It was about alpha project');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const decision = createMockDecision({
                projectId: 'default-project',
                destination: '~/notes/default',
            });
            const result = await handler.collectFeedback(decision);

            expect(result).not.toBeNull();
            expect(result!.correction.projectId).toBe('project-alpha');
            expect(result!.correction.destination).toBe('/notes/alpha');
            expect(result!.correction.topics).toEqual(['ai', 'ml']);
            expect(result!.correction.contextType).toBe('work');
            expect(result!.userReason).toBe('It was about alpha project');
        });

        it('should handle "new" project option', async () => {
            // Responses: wasCorrect, correctProject, newProjectName, correctDestination, topics, contextType, userReason
            setQuestionResponses('n', 'new', 'My New Project', '', '', '', 'Creating new project');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const result = await handler.collectFeedback(createMockDecision());

            expect(result).not.toBeNull();
            expect(result!.correction.projectId).toBe('My New Project');
        });

        it('should handle empty responses for optional fields', async () => {
            // Responses: wasCorrect, correctProject, correctDestination, topics, contextType, userReason
            setQuestionResponses('n', '', '', '', '', 'Just wrong');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const result = await handler.collectFeedback(createMockDecision());

            expect(result).not.toBeNull();
            expect(result!.correction.projectId).toBeUndefined();
            expect(result!.correction.destination).toBeUndefined();
            expect(result!.correction.topics).toBeUndefined();
        });

        it('should display decision with null projectId as (default)', async () => {
            setQuestionResponses('y');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            await handler.collectFeedback(createMockDecision({ projectId: null }));

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('(default)');
        });
    });

    describe('processFeedback', () => {
        it('should call analyzer.analyze with feedback', async () => {
            const mockAnalysis: FeedbackAnalysis = {
                diagnosis: 'Missing project',
                suggestedUpdates: [],
                confidence: 0.8,
            };
            mockAnalyzer.analyze.mockResolvedValue(mockAnalysis);

            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const feedback: ClassificationFeedback = {
                transcriptPath: '/test/transcript.md',
                originalDecision: {
                    projectId: null,
                    destination: '~/notes',
                    confidence: 0.5,
                    reasoning: 'Default',
                },
                correction: {
                    projectId: 'project-alpha',
                    destination: '~/notes/project-alpha',
                },
                userReason: 'This was about Project Alpha',
                providedAt: new Date(),
            };

            const result = await handler.processFeedback(feedback);

            expect(mockAnalyzer.analyze).toHaveBeenCalledWith(feedback);
            expect(result.diagnosis).toBe('Missing project');
        });
    });

    describe('reviewAndApply', () => {
        it('should auto-apply high-confidence updates in non-interactive mode', async () => {
            mockAnalyzer.applyUpdates.mockResolvedValue(undefined);

            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false,
            });

            const analysis: FeedbackAnalysis = {
                diagnosis: 'Test',
                suggestedUpdates: [
                    {
                        type: 'new_project',
                        entityType: 'project',
                        entityId: 'high-conf',
                        changes: [],
                        reasoning: 'High confidence update',
                        confidence: 0.9, // High confidence
                    },
                    {
                        type: 'new_phrase',
                        entityType: 'project',
                        entityId: 'low-conf',
                        changes: [],
                        reasoning: 'Low confidence update',
                        confidence: 0.3, // Low confidence - should be skipped
                    },
                ],
                confidence: 0.8,
            };

            const applied = await handler.reviewAndApply(analysis);

            // Only high-confidence update should be applied
            expect(applied.length).toBe(1);
            expect(applied[0].entityId).toBe('high-conf');
            expect(mockAnalyzer.applyUpdates).toHaveBeenCalledWith([analysis.suggestedUpdates[0]]);
        });

        it('should return empty array when no high-confidence updates', async () => {
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false,
            });

            const analysis: FeedbackAnalysis = {
                diagnosis: 'Test',
                suggestedUpdates: [
                    {
                        type: 'new_phrase',
                        entityType: 'project',
                        entityId: 'low-conf',
                        changes: [],
                        reasoning: 'Low confidence',
                        confidence: 0.5, // Below 0.8 threshold
                    },
                ],
                confidence: 0.5,
            };

            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([]);
            expect(mockAnalyzer.applyUpdates).not.toHaveBeenCalled();
        });

        it('should return empty array when no updates suggested', async () => {
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false,
            });

            const analysis: FeedbackAnalysis = {
                diagnosis: 'Test',
                suggestedUpdates: [],
                confidence: 0.8,
            };

            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([]);
        });
    });

    describe('reviewAndApply (interactive mode)', () => {
        const createAnalysisWithUpdates = (updates: LearningUpdate[]): FeedbackAnalysis => ({
            diagnosis: 'Test diagnosis',
            suggestedUpdates: updates,
            confidence: 0.85,
        });

        const createUpdate = (overrides?: Partial<LearningUpdate>): LearningUpdate => ({
            type: 'new_phrase',
            entityType: 'project',
            entityId: 'test-project',
            changes: [{ field: 'explicit_phrases', oldValue: [], newValue: ['test'] }],
            reasoning: 'Test reasoning',
            confidence: 0.9,
            ...overrides,
        });

        it('should return empty array when no updates suggested in interactive mode', async () => {
            setQuestionResponses(); // No questions expected
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const analysis = createAnalysisWithUpdates([]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([]);
            expect(mockRl.close).toHaveBeenCalled();
        });

        it('should apply updates when user approves (y)', async () => {
            setQuestionResponses('y');
            mockAnalyzer.applyUpdates.mockResolvedValue(undefined);
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const update = createUpdate();
            const analysis = createAnalysisWithUpdates([update]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([update]);
            expect(mockAnalyzer.applyUpdates).toHaveBeenCalledWith([update]);
        });

        it('should apply updates when user approves (yes)', async () => {
            setQuestionResponses('yes');
            mockAnalyzer.applyUpdates.mockResolvedValue(undefined);
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const update = createUpdate();
            const analysis = createAnalysisWithUpdates([update]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([update]);
        });

        it('should skip updates when user denies (n)', async () => {
            setQuestionResponses('n');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const analysis = createAnalysisWithUpdates([createUpdate()]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([]);
            expect(mockAnalyzer.applyUpdates).not.toHaveBeenCalled();
        });

        it('should skip updates when user chooses edit (not implemented)', async () => {
            setQuestionResponses('edit');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const analysis = createAnalysisWithUpdates([createUpdate()]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied).toEqual([]);
            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('Editing not yet implemented');
        });

        it('should handle multiple updates with mixed responses', async () => {
            setQuestionResponses('y', 'n', 'y');
            mockAnalyzer.applyUpdates.mockResolvedValue(undefined);
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const update1 = createUpdate({ entityId: 'project-1' });
            const update2 = createUpdate({ entityId: 'project-2' });
            const update3 = createUpdate({ entityId: 'project-3' });
            
            const analysis = createAnalysisWithUpdates([update1, update2, update3]);
            const applied = await handler.reviewAndApply(analysis);

            expect(applied.length).toBe(2);
            expect(applied[0].entityId).toBe('project-1');
            expect(applied[1].entityId).toBe('project-3');
        });

        it('should display update details including changes', async () => {
            setQuestionResponses('n');
            
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: true,
            });

            const update = createUpdate({
                changes: [
                    { field: 'explicit_phrases', oldValue: [], newValue: ['hello', 'world'] },
                ],
            });
            
            const analysis = createAnalysisWithUpdates([update]);
            await handler.reviewAndApply(analysis);

            const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
            expect(logCalls).toContain('explicit_phrases');
            expect(logCalls).toContain('hello');
        });
    });

    describe('saveFeedback', () => {
        it('should save feedback to disk', async () => {
            // @ts-ignore - mock analyzer
            const handler = create(mockAnalyzer, {
                feedbackDir: tempDir,
                interactive: false,
            });

            const feedback: ClassificationFeedback = {
                transcriptPath: '/test/transcript.md',
                originalDecision: {
                    projectId: null,
                    destination: '~/notes',
                    confidence: 0.5,
                    reasoning: 'Default',
                },
                correction: {
                    projectId: 'test',
                },
                userReason: 'Test reason',
                providedAt: new Date(),
            };

            const analysis: FeedbackAnalysis = {
                diagnosis: 'Test diagnosis',
                suggestedUpdates: [],
                confidence: 0.8,
            };

            await handler.saveFeedback(feedback, analysis);

            // Check that a file was created
            const files = await fs.readdir(tempDir);
            const feedbackFiles = files.filter(f => f.startsWith('feedback-'));
            expect(feedbackFiles.length).toBe(1);

            // Check file contents
            const content = await fs.readFile(path.join(tempDir, feedbackFiles[0]), 'utf-8');
            const parsed = JSON.parse(content);
            expect(parsed.feedback.transcriptPath).toBe('/test/transcript.md');
            expect(parsed.analysis.diagnosis).toBe('Test diagnosis');
        });
    });
});
