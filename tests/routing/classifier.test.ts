import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Classifier from '../../src/routing/classifier';
import * as Context from '../../src/context';
import { ProjectRoute } from '../../src/routing/types';

describe('Intelligent Classifier', () => {
    let mockContext: Context.ContextInstance;
  
    beforeEach(() => {
        mockContext = {
            getPerson: vi.fn((id) => 
                id === 'priya-sharma' ? { id: 'priya-sharma', name: 'Priya Sharma', type: 'person' } : undefined
            ),
            getAllPeople: vi.fn(() => [
                { id: 'priya-sharma', name: 'Priya Sharma', type: 'person', sounds_like: ['pria', 'preya'] }
            ]),
            getAllCompanies: vi.fn(() => [
                { id: 'acme-corp', name: 'Acme Corp', type: 'company', fullName: 'Acme Corporation' }
            ]),
            getCompany: vi.fn((id) =>
                id === 'acme-corp' ? { id: 'acme-corp', name: 'Acme Corp', type: 'company' } : undefined
            ),
            // @ts-ignore - mock partial implementation
        } as Context.ContextInstance;
    });
  
    it('should detect explicit phrases with high confidence', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'quarterly',
            classification: {
                context_type: 'work',
                explicit_phrases: ['quarterly planning meeting'],
                topics: ['planning'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'This is the quarterly planning meeting notes...',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].projectId).toBe('quarterly');
        expect(results[0].confidence).toBeGreaterThan(0.5); // Explicit phrase + context type
        expect(results[0].signals.some(s => s.type === 'explicit_phrase')).toBe(true);
    });
  
    it('should combine multiple signals', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'quarterly',
            classification: {
                context_type: 'work',
                associated_people: ['priya-sharma'],
                topics: ['planning', 'budget'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Met with priya sharma to discuss the budget planning...',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.length).toBeGreaterThan(1);
        // Multiple signals should boost confidence
        expect(results[0].confidence).toBeGreaterThan(0.4);
    });
  
    it('should rank projects by confidence', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [
            {
                projectId: 'general-work',
                classification: {
                    context_type: 'work',
                    topics: ['meeting'],
                },
                destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
            },
            {
                projectId: 'quarterly',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['quarterly planning'],
                    topics: ['planning', 'budget'],
                },
                destination: { path: '~/work/quarterly', structure: 'month', filename_options: ['date', 'subject'] },
            },
        ];
    
        const results = classifier.classify({
            transcriptText: 'This is the quarterly planning meeting...',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        // Quarterly should rank higher due to explicit phrase
        expect(results[0].projectId).toBe('quarterly');
    });
  
    it('should return empty array when no matches found', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'quarterly',
            classification: {
                context_type: 'work',
                explicit_phrases: ['quarterly planning meeting'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Just a random note about nothing specific',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(0);
    });
  
    it('should skip inactive routes', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'quarterly',
            active: false,
            classification: {
                context_type: 'work',
                explicit_phrases: ['quarterly planning meeting'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'This is the quarterly planning meeting notes...',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(0);
    });
  
    it('should detect people by name', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'team-project',
            classification: {
                context_type: 'work',
                associated_people: ['priya-sharma'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Had a meeting with priya sharma today',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_person')).toBe(true);
    });
  
    it('should detect companies', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'client-work',
            classification: {
                context_type: 'work',
                associated_companies: ['acme-corp'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Working on the acme corp project today',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_company')).toBe(true);
    });
  
    it('should infer work context type', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'work-general',
            classification: {
                context_type: 'work',
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Meeting with the team about the project deadline and client report',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'context_type')).toBe(true);
    });
  
    it('should calculate confidence correctly', () => {
        const classifier = Classifier.create(mockContext);
    
        // Single high-weight signal
        const singleSignal = classifier.calculateConfidence([
            { type: 'explicit_phrase', value: 'test', weight: 0.9 }
        ]);
        expect(singleSignal).toBeCloseTo(0.9, 1);
    
        // Multiple signals with diminishing returns
        const multipleSignals = classifier.calculateConfidence([
            { type: 'explicit_phrase', value: 'test', weight: 0.9 },
            { type: 'topic', value: 'topic', weight: 0.3 },
        ]);
        expect(multipleSignals).toBeGreaterThan(singleSignal * 0.5); // Should be higher but not linear
        expect(multipleSignals).toBeLessThan(0.99); // Should be capped
    });
  
    it('should build human-readable reasoning', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'quarterly',
            classification: {
                context_type: 'work',
                explicit_phrases: ['quarterly planning'],
                topics: ['budget'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'quarterly planning discussion about the budget',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results[0].reasoning).toContain('explicit phrase');
        expect(results[0].reasoning).toContain('topic');
    });

    it('should detect people by sounds_like variants', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'team-project',
            classification: {
                context_type: 'work',
                associated_people: ['priya-sharma'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Use the sounds_like variant 'pria' instead of the actual name
        const results = classifier.classify({
            transcriptText: 'had a meeting with pria today about the project',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_person')).toBe(true);
    });

    it('should detect companies by full name only (not short name in text)', () => {
        const contextWithFullName = {
            ...mockContext,
            getAllCompanies: vi.fn(() => [
                // Short name is 'Xyz' which won't be in the text
                { id: 'xyz-corp', name: 'Xyz', type: 'company', fullName: 'Xyz Corporation International' }
            ]),
            getCompany: vi.fn((id) =>
                id === 'xyz-corp' ? { id: 'xyz-corp', name: 'Xyz', type: 'company' } : undefined
            ),
        } as Context.ContextInstance;
        
        const classifier = Classifier.create(contextWithFullName);
    
        const routes: ProjectRoute[] = [{
            projectId: 'client-work',
            classification: {
                context_type: 'work',
                associated_companies: ['xyz-corp'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Use the full name - short name 'Xyz' is not in the text
        const results = classifier.classify({
            transcriptText: 'Working on the xyz corporation international project today',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_company')).toBe(true);
    });

    it('should detect companies by sounds_like variants', () => {
        const contextWithSoundsLike = {
            ...mockContext,
            getAllCompanies: vi.fn(() => [
                { id: 'acme-corp', name: 'Acme Corp', type: 'company', sounds_like: ['akme', 'acmee'] }
            ]),
        } as Context.ContextInstance;
        
        const classifier = Classifier.create(contextWithSoundsLike);
    
        const routes: ProjectRoute[] = [{
            projectId: 'client-work',
            classification: {
                context_type: 'work',
                associated_companies: ['acme-corp'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Use the sounds_like variant 'akme'
        const results = classifier.classify({
            transcriptText: 'Working on the akme project today',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_company')).toBe(true);
    });

    it('should infer personal context type', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'personal-notes',
            classification: {
                context_type: 'personal',
            },
            destination: { path: '~/personal', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Planning for the weekend vacation with family and friends',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'context_type' && s.value === 'personal')).toBe(true);
    });

    it('should return 0 confidence for empty signals array', () => {
        const classifier = Classifier.create(mockContext);
    
        const confidence = classifier.calculateConfidence([]);
        expect(confidence).toBe(0);
    });

    it('should use pre-detected people when provided in context', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'team-project',
            classification: {
                context_type: 'work',
                associated_people: ['priya-sharma'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Provide pre-detected people in the routing context
        const results = classifier.classify({
            transcriptText: 'Some random text without names',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
            detectedPeople: ['priya-sharma'],
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_person')).toBe(true);
    });

    it('should use pre-detected companies when provided in context', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'client-work',
            classification: {
                context_type: 'work',
                associated_companies: ['acme-corp'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Provide pre-detected companies in the routing context
        const results = classifier.classify({
            transcriptText: 'Some random text without company names',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
            detectedCompanies: ['acme-corp'],
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'associated_company')).toBe(true);
    });

    it('should handle routes with missing classification fields gracefully', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'minimal-route',
            classification: {
                context_type: 'work',
                // No explicit_phrases, associated_people, associated_companies, or topics
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Team meeting about the project deadline',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        // Should still detect context_type
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'context_type')).toBe(true);
    });

    it('should handle person lookup when person not found in context', () => {
        const contextWithMissingPerson = {
            ...mockContext,
            getPerson: vi.fn(() => undefined), // Person not found
        } as Context.ContextInstance;
        
        const classifier = Classifier.create(contextWithMissingPerson);
    
        const routes: ProjectRoute[] = [{
            projectId: 'team-project',
            classification: {
                context_type: 'work',
                associated_people: ['unknown-person'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Working on something',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
            detectedPeople: ['unknown-person'],
        }, routes);
    
        expect(results.length).toBe(1);
        // Should use the ID as fallback for name
        expect(results[0].signals.some(s => s.type === 'associated_person' && s.value === 'unknown-person')).toBe(true);
    });

    it('should handle company lookup when company not found in context', () => {
        const contextWithMissingCompany = {
            ...mockContext,
            getCompany: vi.fn(() => undefined), // Company not found
        } as Context.ContextInstance;
        
        const classifier = Classifier.create(contextWithMissingCompany);
    
        const routes: ProjectRoute[] = [{
            projectId: 'client-work',
            classification: {
                context_type: 'work',
                associated_companies: ['unknown-company'],
            },
            destination: { path: '~/work', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        const results = classifier.classify({
            transcriptText: 'Working on client stuff',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
            detectedCompanies: ['unknown-company'],
        }, routes);
    
        expect(results.length).toBe(1);
        // Should use the ID as fallback for name
        expect(results[0].signals.some(s => s.type === 'associated_company' && s.value === 'unknown-company')).toBe(true);
    });

    it('should handle mixed context type when neither work nor personal dominates', () => {
        const classifier = Classifier.create(mockContext);
    
        const routes: ProjectRoute[] = [{
            projectId: 'mixed-notes',
            classification: {
                context_type: 'mixed',
            },
            destination: { path: '~/notes', structure: 'month', filename_options: ['date', 'subject'] },
        }];
    
        // Text with balanced work/personal indicators
        const results = classifier.classify({
            transcriptText: 'Meeting today, also planning weekend activities',
            audioDate: new Date(),
            sourceFile: 'recording.m4a',
        }, routes);
    
        expect(results.length).toBe(1);
        expect(results[0].signals.some(s => s.type === 'context_type' && s.value === 'mixed')).toBe(true);
    });
});

