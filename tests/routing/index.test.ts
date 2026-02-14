import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Routing from '../../src/routing';
import * as Context from '../../src/context';

describe('Routing System', () => {
    let mockContext: Context.ContextInstance;
  
    beforeEach(() => {
        mockContext = {
            getPerson: vi.fn(() => undefined),
            getAllPeople: vi.fn(() => []),
            getAllCompanies: vi.fn(() => []),
            getCompany: vi.fn(() => undefined),
            // @ts-ignore - mock partial implementation
        } as Context.ContextInstance;
    });
  
    it('should create routing instance', () => {
        const routing = Routing.create({
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        }, mockContext);
    
        expect(routing).toBeDefined();
        expect(routing.route).toBeDefined();
        expect(routing.buildOutputPath).toBeDefined();
    });
  
    it('should route to default when no projects match', () => {
        const routing = Routing.create({
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        }, mockContext);
    
        const decision = routing.route({
            transcriptText: 'Random note content',
            audioDate: new Date(),
            sourceFile: 'test.m4a',
        });
    
        expect(decision.projectId).toBeNull();
        expect(decision.destination.path).toBe('~/notes');
    });
  
    it('should add project dynamically', () => {
        const routing = Routing.create({
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        }, mockContext);
    
        routing.addProject({
            projectId: 'new-project',
            classification: {
                context_type: 'work',
                explicit_phrases: ['new project'],
            },
            destination: {
                path: '~/work/new',
                structure: 'month',
                filename_options: ['date'],
            },
        });
    
        const config = routing.getConfig();
        expect(config.projects.length).toBe(1);
        expect(config.projects[0].projectId).toBe('new-project');
    });
  
    it('should update default route', () => {
        const routing = Routing.create({
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        }, mockContext);
    
        routing.updateDefaultRoute({
            path: '~/new-default',
            structure: 'year',
            filename_options: ['date'],
        });
    
        const config = routing.getConfig();
        expect(config.default.path).toBe('~/new-default');
        expect(config.default.structure).toBe('year');
    });
  
    it('should route to matching project', () => {
        const routing = Routing.create({
            default: {
                path: '~/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [{
                projectId: 'quarterly',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['quarterly planning'],
                },
                destination: {
                    path: '~/work/quarterly',
                    structure: 'month',
                    filename_options: ['date', 'subject'],
                },
                auto_tags: ['work', 'planning'],
            }],
            conflict_resolution: 'primary',
        }, mockContext);
    
        const decision = routing.route({
            transcriptText: 'This is the quarterly planning meeting notes',
            audioDate: new Date(),
            sourceFile: 'test.m4a',
        });
    
        expect(decision.projectId).toBe('quarterly');
        expect(decision.destination.path).toBe('~/work/quarterly');
        expect(decision.auto_tags).toContain('work');
    });
  
    it('should build correct output path', () => {
        const routing = Routing.create({
            default: {
                path: '/tmp/notes',
                structure: 'month',
                filename_options: ['date', 'subject'],
            },
            projects: [],
            conflict_resolution: 'primary',
        }, mockContext);
    
        const context = {
            transcriptText: 'Test meeting notes',
            audioDate: new Date('2026-05-10T14:30:00'),
            sourceFile: 'test.m4a',
        };
    
        const decision = routing.route(context);
        const outputPath = routing.buildOutputPath(decision, context);
    
        expect(outputPath).toContain('/tmp/notes/2026/5/');
        // With month structure, path has year/month, so filename only needs day
        expect(outputPath).toContain('10-');
        expect(outputPath.endsWith('.md')).toBe(true);
    });
});

