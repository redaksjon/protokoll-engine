import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Router from '../../src/routing/router';
import * as Classifier from '../../src/routing/classifier';
import { RoutingConfig, RoutingContext } from '../../src/routing/types';
import * as os from 'os';
import * as path from 'path';

describe('Router', () => {
    let mockClassifier: Classifier.ClassifierInstance;
    let defaultConfig: RoutingConfig;
  
    beforeEach(() => {
        mockClassifier = {
            classify: vi.fn(() => []),
            calculateConfidence: vi.fn(() => 0.5),
        };
    
        defaultConfig = {
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        };
    });
  
    describe('route', () => {
        it('should return default route when no matches', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const decision = router.route({
                transcriptText: 'Some random text',
                audioDate: new Date(),
                sourceFile: 'test.m4a',
            });
      
            expect(decision.projectId).toBeNull();
            expect(decision.destination.path).toBe('~/notes');
            expect(decision.reasoning).toContain('default');
        });
    
        it('should return best match when found', () => {
            const config: RoutingConfig = {
                ...defaultConfig,
                projects: [{
                    projectId: 'quarterly',
                    classification: { context_type: 'work' },
                    destination: {
                        path: '~/work/quarterly',
                        structure: 'month',
                        filename_options: ['date', 'subject'],
                    },
                    auto_tags: ['work', 'planning'],
                }],
            };
      
            mockClassifier.classify = vi.fn(() => [{
                projectId: 'quarterly',
                confidence: 0.8,
                signals: [{ type: 'explicit_phrase', value: 'quarterly', weight: 0.9 }],
                reasoning: 'explicit phrase: "quarterly"',
            }]);
      
            const router = Router.create(config, mockClassifier);
      
            const decision = router.route({
                transcriptText: 'quarterly planning meeting',
                audioDate: new Date(),
                sourceFile: 'test.m4a',
            });
      
            expect(decision.projectId).toBe('quarterly');
            expect(decision.destination.path).toBe('~/work/quarterly');
            expect(decision.auto_tags).toContain('work');
        });
    
        it('should include alternate matches when conflict resolution is not primary', () => {
            const config: RoutingConfig = {
                ...defaultConfig,
                conflict_resolution: 'ask',
                projects: [
                    {
                        projectId: 'project-a',
                        classification: { context_type: 'work' },
                        destination: { path: '~/a', structure: 'month', filename_options: ['date'] },
                    },
                    {
                        projectId: 'project-b',
                        classification: { context_type: 'work' },
                        destination: { path: '~/b', structure: 'month', filename_options: ['date'] },
                    },
                ],
            };
      
            mockClassifier.classify = vi.fn(() => [
                { projectId: 'project-a', confidence: 0.7, signals: [], reasoning: 'match a' },
                { projectId: 'project-b', confidence: 0.6, signals: [], reasoning: 'match b' },
            ]);
      
            const router = Router.create(config, mockClassifier);
      
            const decision = router.route({
                transcriptText: 'some text',
                audioDate: new Date(),
                sourceFile: 'test.m4a',
            });
      
            expect(decision.projectId).toBe('project-a');
            expect(decision.alternateMatches).toBeDefined();
            expect(decision.alternateMatches?.length).toBe(1);
            expect(decision.alternateMatches?.[0].projectId).toBe('project-b');
        });
    
        it('should not include alternate matches when conflict resolution is primary', () => {
            const config: RoutingConfig = {
                ...defaultConfig,
                conflict_resolution: 'primary',
                projects: [
                    {
                        projectId: 'project-a',
                        classification: { context_type: 'work' },
                        destination: { path: '~/a', structure: 'month', filename_options: ['date'] },
                    },
                    {
                        projectId: 'project-b',
                        classification: { context_type: 'work' },
                        destination: { path: '~/b', structure: 'month', filename_options: ['date'] },
                    },
                ],
            };
      
            mockClassifier.classify = vi.fn(() => [
                { projectId: 'project-a', confidence: 0.7, signals: [], reasoning: 'match a' },
                { projectId: 'project-b', confidence: 0.6, signals: [], reasoning: 'match b' },
            ]);
      
            const router = Router.create(config, mockClassifier);
      
            const decision = router.route({
                transcriptText: 'some text',
                audioDate: new Date(),
                sourceFile: 'test.m4a',
            });
      
            expect(decision.alternateMatches).toBeUndefined();
        });
    });
  
    describe('buildOutputPath', () => {
        it('should build path with month structure', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Meeting notes about the project',
                audioDate: new Date('2026-03-15T10:30:00'),
                sourceFile: 'recording.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'month' as const,
                    filename_options: ['date', 'subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain('/tmp/notes/2026/3/');
            // With month structure, path has year/month, so filename only needs day
            expect(outputPath).toContain('15-');
            expect(outputPath.endsWith('.md')).toBe(true);
        });
    
        it('should build path with year structure', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Some notes',
                audioDate: new Date('2026-06-20T14:00:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'year' as const,
                    filename_options: ['date'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain('/tmp/notes/2026/');
            expect(outputPath).not.toContain('/tmp/notes/2026/6/');
        });
    
        it('should build path with day structure', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Daily notes',
                audioDate: new Date('2026-12-25T09:00:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'day' as const,
                    filename_options: ['time'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain('/tmp/notes/2026/12/25/');
            expect(outputPath).toContain('0900');
        });
    
        it('should build path with none structure', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Flat notes',
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/flat',
                    structure: 'none' as const,
                    filename_options: ['date', 'time'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toBe('/tmp/flat/260101-1200.md'); // YYMMDD-HHmm format
        });
    
        it('should expand ~ to home directory', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Home notes',
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '~/notes',
                    structure: 'none' as const,
                    filename_options: ['date'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain(os.homedir());
            expect(outputPath).not.toContain('~');
        });
    
        it('should extract subject from transcript', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Budget review for Q1. We discussed various items.',
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'none' as const,
                    filename_options: ['subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain('budget-review-for-q1');
        });
    
        it('should fall back to source filename for subject', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Hi', // Too short
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: 'my-recording-2026.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'none' as const,
                    filename_options: ['subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            expect(outputPath).toContain('my-recording-2026');
        });

        it('should build path with day structure and date filename option - no date in filename', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Daily meeting notes',
                audioDate: new Date('2026-12-25T14:30:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'day' as const,
                    filename_options: ['date', 'subject'] as const, // 'date' with 'day' structure should add nothing
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            // With day structure, the path already has year/month/day, so date option adds nothing to filename
            expect(outputPath).toContain('/tmp/notes/2026/12/25/');
            // Should not have redundant date info in filename
            expect(outputPath).toContain('daily-meeting-notes');
        });

        it('should handle all filename options combined', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'Project review meeting notes',
                audioDate: new Date('2026-06-15T09:45:00'),
                sourceFile: 'test.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'none' as const,
                    filename_options: ['date', 'time', 'subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            // Should have full date (YYMMDD), time (HHmm), and subject
            expect(outputPath).toMatch(/260615.*0945.*project-review-meeting-notes/);
        });

        it('should handle empty subject when extract fails', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                transcriptText: 'ok', // Too short to extract subject (less than 3 chars after cleaning)
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: '.m4a', // No filename to fall back to
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'none' as const,
                    filename_options: ['subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            // Should still produce a valid path - will use 'm4a' from source file
            expect(outputPath).toContain('/tmp/notes/');
            expect(outputPath.endsWith('.md')).toBe(true);
        });

        it('should handle very long subject extraction (over 50 chars)', () => {
            const router = Router.create(defaultConfig, mockClassifier);
      
            const context: RoutingContext = {
                // First sentence is way over 50 chars but extractSubject will truncate/skip
                transcriptText: 'This is an extremely long first sentence that definitely exceeds fifty characters and should not be used as the subject because it is too verbose.',
                audioDate: new Date('2026-01-01T12:00:00'),
                sourceFile: 'fallback-file.m4a',
            };
      
            const decision = {
                projectId: null,
                destination: {
                    path: '/tmp/notes',
                    structure: 'none' as const,
                    filename_options: ['subject'] as const,
                },
                confidence: 1.0,
                signals: [],
                reasoning: 'default',
            };
      
            const outputPath = router.buildOutputPath(decision, context);
      
            // Should fall back to source file name since sentence is too long
            expect(outputPath).toContain('fallback-file');
        });
    });
});

