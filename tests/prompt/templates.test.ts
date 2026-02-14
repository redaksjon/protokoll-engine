import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { 
    initializeTemplates, 
    getTemplateNames, 
    selectTemplate,
    getTemplate,
    clearAllTemplates,
    TEMPLATES
} from '../../src/prompt/templates';

describe('Transcription Templates', () => {
    beforeAll(() => {
        initializeTemplates();
    });

    afterAll(() => {
        clearAllTemplates();
    });

    describe('Template Registration', () => {
        it('registers all defined templates', () => {
            const names = getTemplateNames();
            expect(names).toContain('transcription-standard');
            expect(names).toContain('transcription-meeting');
            expect(names).toContain('transcription-technical');
            expect(names).toContain('transcription-quick');
            expect(names).toContain('transcription-interview');
        });

        it('has correct number of templates', () => {
            const names = getTemplateNames();
            expect(names.length).toBeGreaterThanOrEqual(5);
        });

        it('can retrieve individual templates', () => {
            const template = getTemplate('transcription-standard');
            expect(template).toBeDefined();
            expect(template?.persona).toBeDefined();
            expect(template?.constraints).toBeDefined();
        });
    });

    describe('Template Auto-Selection', () => {
        it('selects meeting template for meeting content', () => {
            const transcript = 'The meeting agenda for today includes three action items...';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-meeting');
        });

        it('selects meeting template for minutes content', () => {
            const transcript = 'Minutes from the quarterly review meeting with attendees...';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-meeting');
        });

        it('selects technical template for code content', () => {
            const transcript = 'The API endpoint handles the function call...';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-technical');
        });

        it('selects technical template for technical terms', () => {
            const transcript = 'We need to update the React components and the npm packages...';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-technical');
        });

        it('selects interview template for Q&A format', () => {
            const transcript = 'Q: What is your background? A: I have 10 years experience in software engineering and team leadership. Q: What are your goals? A: To grow the team and improve our development processes. Q: How do you handle challenges? A: I focus on clear communication and collaborative problem-solving with the team.';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-interview');
        });

        it('selects quick template for short content', () => {
            const transcript = 'Remember to buy milk and call John.';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-quick');
        });

        it('selects standard template for general content', () => {
            const transcript = 'This is a general discussion about various topics that do not fit into specific categories. We talked about the weather, upcoming plans for the weekend, and some interesting books we have been reading. The conversation flowed naturally between different subjects without any particular technical focus or structured format.';
            const template = selectTemplate(transcript);
            expect(template).toBe('transcription-standard');
        });
    });

    describe('Template Hints', () => {
        it('respects explicit meeting hint', () => {
            const transcript = 'Some random text';
            const template = selectTemplate(transcript, { isMeeting: true });
            expect(template).toBe('transcription-meeting');
        });

        it('respects explicit technical hint', () => {
            const transcript = 'Some random text';
            const template = selectTemplate(transcript, { isTechnical: true });
            expect(template).toBe('transcription-technical');
        });

        it('respects explicit quick hint', () => {
            const transcript = 'Some random text';
            const template = selectTemplate(transcript, { isQuick: true });
            expect(template).toBe('transcription-quick');
        });

        it('respects explicit interview hint', () => {
            const transcript = 'Some random text';
            const template = selectTemplate(transcript, { isInterview: true });
            expect(template).toBe('transcription-interview');
        });

        it('prioritizes hints over content detection', () => {
            const transcript = 'The meeting agenda includes action items';
            const template = selectTemplate(transcript, { isTechnical: true });
            expect(template).toBe('transcription-technical');
        });
    });

    describe('Template Structure', () => {
        it('standard template has required fields', () => {
            const template = TEMPLATES['transcription-standard'];
            expect(template.persona).toBeDefined();
            expect(template.constraints).toBeDefined();
            expect(template.tone).toBeDefined();
            expect(Array.isArray(template.constraints)).toBe(true);
            expect(Array.isArray(template.tone)).toBe(true);
        });

        it('meeting template has required fields', () => {
            const template = TEMPLATES['transcription-meeting'];
            expect(template.persona).toBeDefined();
            expect(template.constraints).toBeDefined();
            expect(template.tone).toBeDefined();
        });

        it('technical template has required fields', () => {
            const template = TEMPLATES['transcription-technical'];
            expect(template.persona).toBeDefined();
            expect(template.constraints).toBeDefined();
            expect(template.tone).toBeDefined();
        });

        it('all templates have persona content', () => {
            Object.entries(TEMPLATES).forEach(([name, template]) => {
                expect(template.persona).toBeDefined();
                expect(typeof template.persona?.content === 'string').toBe(true);
            });
        });

        it('all templates have non-empty constraints', () => {
            Object.entries(TEMPLATES).forEach(([name, template]) => {
                expect(template.constraints).toBeDefined();
                expect(Array.isArray(template.constraints)).toBe(true);
                expect(template.constraints!.length).toBeGreaterThan(0);
            });
        });
    });

    describe('Template Clearing', () => {
        it('can clear all templates', () => {
            clearAllTemplates();
            const names = getTemplateNames();
            expect(names.length).toBe(0);
            
            // Re-initialize for other tests
            initializeTemplates();
        });

        it('can re-initialize after clearing', () => {
            clearAllTemplates();
            initializeTemplates();
            const names = getTemplateNames();
            expect(names.length).toBeGreaterThanOrEqual(5);
        });
    });
});
