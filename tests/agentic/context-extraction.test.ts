/**
 * Tests for transcript context extraction in lookup tools
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
    isIgnored: vi.fn(() => false),
} as any;

// Mock routing instance
const mockRoutingInstance = {} as any;

describe('Transcript Context Extraction', () => {
    let baseContext: ToolContext;

    beforeEach(() => {
        vi.clearAllMocks();
        
        baseContext = {
            transcriptText: '',
            audioDate: new Date('2026-01-15T07:10:00'),
            sourceFile: '/path/to/recording.m4a',
            contextInstance: mockContextInstance,
            routingInstance: mockRoutingInstance,
            interactiveMode: true,
        };
    });

    describe('Person Context Extraction', () => {
        it('should extract context around person name', async () => {
            const transcript = `
                Yesterday I had a meeting with our team. 
                I spoke with Trey Toulson about the new project. 
                He's the VP of Engineering at Acme Corp. 
                We discussed the Phoenix Initiative and next steps.
            `;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Trey Toulson' });
            
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Trey Toulson');
            expect(result.userPrompt).toContain('Context from transcript:');
            // Should include surrounding sentences
            expect(result.userPrompt).toContain('VP of Engineering');
        });

        it('should handle name at start of transcript', async () => {
            const transcript = `Trey Toulson joined our meeting today. He provided updates on the project.`;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Trey Toulson' });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('joined our meeting');
        });

        it('should handle name at end of transcript', async () => {
            const transcript = `We need to follow up with the VP of Engineering, Trey Toulson.`;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Trey Toulson' });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('VP of Engineering');
        });

        it('should handle case-insensitive name matching', async () => {
            const transcript = `I met with TREY TOULSON yesterday. He's leading the Phoenix project.`;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'trey toulson' });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('Phoenix project');
        });

        it('should handle name not found in transcript', async () => {
            const transcript = `This is a transcript without the person mentioned.`;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Jane Doe' });
            
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('Unknown person mentioned: "Jane Doe"');
            // Should not have context section if name not found
            expect(result.userPrompt).not.toContain('Context from transcript:');
        });

        it('should limit context length for very long transcripts', async () => {
            // Create a very long transcript
            const longSentence = 'This is a very long sentence that goes on and on. '.repeat(20);
            const transcript = `${longSentence} Trey Toulson is mentioned here. ${longSentence}`;
            
            const tool = LookupPerson.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Trey Toulson' });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            // Extract the context part
            const contextMatch = result.userPrompt?.match(/"([^"]*)"/);
            if (contextMatch) {
                const extractedContext = contextMatch[1];
                // Should be limited to reasonable length
                expect(extractedContext.length).toBeLessThan(400);
                // Should still contain the name
                expect(extractedContext.toLowerCase()).toContain('trey toulson');
            }
        });
    });

    describe('Project Context Extraction', () => {
        it('should extract context around project term', async () => {
            const transcript = `
                We're making great progress on the Phoenix Initiative. 
                The team has completed the initial architecture design. 
                Next week we'll start implementation.
            `;
            
            const tool = LookupProject.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Phoenix Initiative' });
            
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Phoenix Initiative');
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('architecture design');
        });

        it('should use trigger phrase as fallback if term not found', async () => {
            const transcript = `This transcript doesn't mention the exact term.`;
            
            const tool = LookupProject.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ 
                name: 'Phoenix Initiative',
                triggerPhrase: 'we are working on Phoenix'
            });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('we are working on Phoenix');
        });

        it('should handle multiple sentence boundaries', async () => {
            const transcript = `
                First sentence. Second sentence! 
                Now we discuss the Phoenix Initiative? 
                Fourth sentence here.
            `;
            
            const tool = LookupProject.create({
                ...baseContext,
                transcriptText: transcript,
            });
            
            const result = await tool.execute({ name: 'Phoenix Initiative' });
            
            expect(result.userPrompt).toContain('Context from transcript:');
            // Should extract around the mention
            const contextMatch = result.userPrompt?.match(/"([^"]*)"/);
            expect(contextMatch).toBeTruthy();
        });
    });

    describe('File Metadata Display', () => {
        it('should display file name and date', async () => {
            const tool = LookupPerson.create({
                ...baseContext,
                sourceFile: '/recordings/2026/team-meeting-jan15.m4a',
                transcriptText: 'Mentioned John Doe in the meeting.',
            });
            
            const result = await tool.execute({ name: 'John Doe' });
            
            expect(result.userPrompt).toContain('File: team-meeting-jan15.m4a');
            expect(result.userPrompt).toContain('Date:');
            expect(result.userPrompt).toContain('2026');
        });

        it('should handle paths with spaces', async () => {
            const tool = LookupPerson.create({
                ...baseContext,
                sourceFile: '/recordings/my recordings/team meeting jan 15.m4a',
                transcriptText: 'Mentioned John Doe.',
            });
            
            const result = await tool.execute({ name: 'John Doe' });
            
            expect(result.userPrompt).toContain('File: team meeting jan 15.m4a');
        });
    });
});
