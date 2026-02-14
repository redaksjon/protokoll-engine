/**
 * Tests for resolved entities tracking to prevent duplicate questions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as LookupPerson from '../../src/agentic/tools/lookup-person';
import * as LookupProject from '../../src/agentic/tools/lookup-project';
import { ToolContext } from '../../src/agentic/types';

// Mock context instance
const mockContextInstance = {
    search: vi.fn(() => []),
    searchWithContext: vi.fn(() => []),
    findBySoundsLike: vi.fn(() => null),
    getAllProjects: vi.fn(() => []),
    saveEntity: vi.fn(),
    reload: vi.fn(),
    isIgnored: vi.fn(() => false),
} as any;

// Mock routing instance
const mockRoutingInstance = {} as any;

describe('Resolved Entities Tracking', () => {
    let baseContext: ToolContext;
    let resolvedEntities: Map<string, string>;

    beforeEach(() => {
        vi.clearAllMocks();
        
        resolvedEntities = new Map();
        
        baseContext = {
            transcriptText: 'Test transcript with people and projects',
            audioDate: new Date('2026-01-15T07:10:00'),
            sourceFile: '/path/to/recording.m4a',
            contextInstance: mockContextInstance,
            routingInstance: mockRoutingInstance,
            interactiveMode: true,
            resolvedEntities,
        };
    });

    describe('Person Lookup', () => {
        it('should prompt for unknown person on first lookup', async () => {
            const tool = LookupPerson.create(baseContext);
            
            const result = await tool.execute({ name: 'John Doe' });
            
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Unknown person mentioned: "John Doe"');
        });

        it('should NOT prompt for person already resolved in this session', async () => {
            // Simulate that user already answered this question
            resolvedEntities.set('John Doe', 'John D. Doe (VP Engineering)');
            
            const tool = LookupPerson.create(baseContext);
            const result = await tool.execute({ name: 'John Doe' });
            
            // Should return cached result without prompting
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBeUndefined();
            expect(result.data?.cached).toBe(true);
            expect(result.data?.suggestion).toContain('Already resolved');
            expect(result.data?.suggestion).toContain('John D. Doe (VP Engineering)');
        });

        it('should avoid prompting multiple times for same person', async () => {
            const tool = LookupPerson.create(baseContext);
            
            // First lookup - should prompt
            const result1 = await tool.execute({ name: 'Jane Smith' });
            expect(result1.needsUserInput).toBe(true);
            
            // Simulate user answering the question
            resolvedEntities.set('Jane Smith', 'Jane Smith (CTO)');
            
            // Second lookup - should NOT prompt
            const result2 = await tool.execute({ name: 'Jane Smith' });
            expect(result2.needsUserInput).toBeUndefined();
            expect(result2.data?.cached).toBe(true);
            expect(result2.data?.suggestion).toContain('Jane Smith (CTO)');
        });
    });

    describe('Project Lookup', () => {
        it('should prompt for unknown project on first lookup', async () => {
            const tool = LookupProject.create(baseContext);
            
            const result = await tool.execute({ name: 'Phoenix Initiative' });
            
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Unknown project/term: "Phoenix Initiative"');
        });

        it('should NOT prompt for project already resolved in this session', async () => {
            // Simulate that user already answered this question
            resolvedEntities.set('Phoenix Initiative', 'Phoenix Initiative (Active Project)');
            
            const tool = LookupProject.create(baseContext);
            const result = await tool.execute({ name: 'Phoenix Initiative' });
            
            // Should return cached result without prompting
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBeUndefined();
            expect(result.data?.cached).toBe(true);
            expect(result.data?.suggestion).toContain('Already resolved');
        });

        it('should avoid prompting multiple times for same project', async () => {
            const tool = LookupProject.create(baseContext);
            
            // First lookup - should prompt
            const result1 = await tool.execute({ name: 'Project X' });
            expect(result1.needsUserInput).toBe(true);
            
            // Simulate user answering the question
            resolvedEntities.set('Project X', 'Project X - Internal Research');
            
            // Second lookup - should NOT prompt
            const result2 = await tool.execute({ name: 'Project X' });
            expect(result2.needsUserInput).toBeUndefined();
            expect(result2.data?.cached).toBe(true);
        });
    });

    describe('Cross-Tool Resolution', () => {
        it('should share resolved entities across different tool instances', async () => {
            // First tool adds a resolved entity
            resolvedEntities.set('Shared Term', 'Shared Term (Resolved)');
            
            const personTool = LookupPerson.create(baseContext);
            const projectTool = LookupProject.create(baseContext);
            
            // Both should see the same resolved entity (though this test is more about the pattern)
            const personResult = await personTool.execute({ name: 'Shared Term' });
            const projectResult = await projectTool.execute({ name: 'Shared Term' });
            
            expect(personResult.data?.cached).toBe(true);
            expect(projectResult.data?.cached).toBe(true);
        });
    });

    describe('Without Resolved Entities', () => {
        it('should work when resolvedEntities is undefined', async () => {
            const contextWithoutResolved: ToolContext = {
                ...baseContext,
                resolvedEntities: undefined,
            };
            
            const tool = LookupPerson.create(contextWithoutResolved);
            const result = await tool.execute({ name: 'Test Person' });
            
            // Should fall through to normal lookup without crashing
            expect(result.success).toBe(true);
        });
    });
});
