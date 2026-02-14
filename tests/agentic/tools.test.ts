import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as LookupPerson from '../../src/agentic/tools/lookup-person';
import * as LookupProject from '../../src/agentic/tools/lookup-project';
import * as VerifySpelling from '../../src/agentic/tools/verify-spelling';
import * as RouteNote from '../../src/agentic/tools/route-note';
import * as StoreContext from '../../src/agentic/tools/store-context';
import { ToolContext } from '../../src/agentic/types';

describe('Agentic Tools', () => {
    let mockContext: ToolContext;
  
    beforeEach(() => {
        mockContext = {
            transcriptText: 'Test transcript',
            audioDate: new Date('2026-01-11'),
            sourceFile: 'test.m4a',
            contextInstance: {
                search: vi.fn(() => []),
                searchWithContext: vi.fn(() => []),
                findBySoundsLike: vi.fn(() => undefined),
                getAllProjects: vi.fn(() => []),
                isIgnored: vi.fn(() => false),
                // @ts-ignore
            },
            routingInstance: {
                route: vi.fn(() => ({
                    projectId: null,
                    destination: { path: '~/notes', structure: 'month', filename_options: ['date'] },
                    confidence: 1.0,
                    signals: [],
                    reasoning: 'default',
                })),
                buildOutputPath: vi.fn(() => '/tmp/notes/2026/1/1-11-test.md'),
                // @ts-ignore
            },
            interactiveMode: false,
        };
    });
  
    describe('lookup_person', () => {
        it('should return found when person exists', async () => {
            mockContext.contextInstance.search = vi.fn(() => [
                { id: 'john', name: 'John Smith', type: 'person' }
            ]);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.person.name).toBe('John Smith');
        });
    
        it('should return not found when person does not exist', async () => {
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
        });
    
        it('should try phonetic match when phonetic arg provided', async () => {
            mockContext.contextInstance.findBySoundsLike = vi.fn(() => ({
                id: 'priya', name: 'Priya Sharma', type: 'person'
            }));
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Pria', phonetic: 'pria' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
        });

        it('should not try phonetic match when phonetic arg not provided', async () => {
            mockContext.contextInstance.search = vi.fn(() => []);
            mockContext.contextInstance.findBySoundsLike = vi.fn();
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            expect(mockContext.contextInstance.findBySoundsLike).not.toHaveBeenCalled();
        });

        it('should return not found when phonetic match fails', async () => {
            mockContext.contextInstance.search = vi.fn(() => []);
            mockContext.contextInstance.findBySoundsLike = vi.fn(() => undefined);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown', phonetic: 'phonetic' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
        });

        it('should return cached result for already resolved entities', async () => {
            const resolvedEntities = new Map<string, string>();
            resolvedEntities.set('John', 'John Smith');
            mockContext.resolvedEntities = resolvedEntities;
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.cached).toBe(true);
            expect(result.data.suggestion).toContain('John Smith');
            // Should not call search when cached
            expect(mockContext.contextInstance.search).not.toHaveBeenCalled();
        });

        it('should filter non-person results from search', async () => {
            mockContext.contextInstance.search = vi.fn(() => [
                { id: 'alpha', name: 'Project Alpha', type: 'project' },
                { id: 'john', name: 'John Smith', type: 'person' }
            ]);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Alpha' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.person.type).toBe('person');
        });

        it('should return not found when search returns only non-person results', async () => {
            mockContext.contextInstance.search = vi.fn(() => [
                { id: 'alpha', name: 'Project Alpha', type: 'project' }
            ]);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Alpha' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
        });

        it('should include transcript context in prompt when name is found', async () => {
            mockContext.transcriptText = 'First sentence. Then John mentioned something important. Last part.';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('John');
        });

        it('should not include transcript context when name not in transcript', async () => {
            mockContext.transcriptText = 'This transcript has no matching names.';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).not.toContain('Context from transcript:');
        });

        it('should include file and date info in prompt', async () => {
            mockContext.sourceFile = '/path/to/audio/recording.m4a';
            mockContext.audioDate = new Date('2026-01-15T14:30:00');
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('File: recording.m4a');
            expect(result.userPrompt).toContain('2026');
        });

        it('should handle sourceFile without path separators', async () => {
            mockContext.sourceFile = 'recording.m4a';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('File: recording.m4a');
        });

        it('should fallback to full sourceFile when path ends with slash', async () => {
            // When sourceFile ends with '/', split('/').pop() returns '', triggering the fallback
            mockContext.sourceFile = '/path/to/directory/';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            // The fallback uses the full sourceFile path
            expect(result.userPrompt).toContain('File: /path/to/directory/');
        });

        it('should format project options with descriptions', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [
                { id: 'proj1', name: 'Project One', type: 'project', active: true, description: 'First project' },
                { id: 'proj2', name: 'Project Two', type: 'project', active: true }
            ]);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.options).toContain('Project One - First project');
            expect(result.data.options).toContain('Project Two');
        });

        it('should filter inactive projects from options', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [
                { id: 'proj1', name: 'Active Project', type: 'project', active: true },
                { id: 'proj2', name: 'Inactive Project', type: 'project', active: false }
            ]);
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.options).toContain('Active Project');
            expect(result.data.options).not.toContain('Inactive Project');
            expect(result.data.knownProjects).toHaveLength(1);
        });

        it('should extract context with multiple sentences around name', async () => {
            mockContext.transcriptText = 'First sentence here. Second sentence. Then Sarah spoke about something. Fourth sentence. Fifth sentence.';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'Sarah' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('Sarah');
            // Context should include surrounding sentences
            expect(result.userPrompt).toContain('Second sentence');
        });

        it('should handle name at start of transcript', async () => {
            mockContext.transcriptText = 'John started the meeting. Then we discussed topics.';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('John started');
        });

        it('should handle name at end of transcript', async () => {
            mockContext.transcriptText = 'The meeting was led by John';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('John');
        });

        it('should truncate very long context to sentence containing name', async () => {
            // Create a context that DEFINITELY exceeds 300 chars when extracted
            // Using a single very long sentence before and after to ensure extraction > 300 chars
            // The extraction algorithm finds 2 sentence boundaries in each direction
            const veryLongSentence = 'This is a very long sentence that just keeps going and going with more and more words added to make it extremely long so that when combined with other sentences the total context will definitely exceed three hundred characters which is the threshold for truncation';
            const longText = `${veryLongSentence}. ${veryLongSentence}. Then John spoke. ${veryLongSentence}. ${veryLongSentence}.`;
            mockContext.transcriptText = longText;
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'John' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('John');
        });

        it('should truncate with ellipsis when name not found in long extracted context', async () => {
            // Test line 89 - name exists via case-insensitive search but case-sensitive indexOf fails
            const veryLongSentence = 'This is a very long sentence that just keeps going and going with more and more words added to make it extremely long so that when combined with other sentences the total context will definitely exceed three hundred characters which is the threshold for truncation';
            const longText = `${veryLongSentence}. ${veryLongSentence}. Then JOHN spoke. ${veryLongSentence}. ${veryLongSentence}.`;
            mockContext.transcriptText = longText;
      
            const tool = LookupPerson.create(mockContext);
            // Search lowercase - findIndex uses toLowerCase but context.indexOf is case-sensitive
            const result = await tool.execute({ name: 'john' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toBeDefined();
            expect(result.needsUserInput).toBe(true);
        });

        it('should handle case-insensitive name matching in transcript', async () => {
            mockContext.transcriptText = 'We met with JOHN SMITH today.';
      
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'john' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('JOHN SMITH');
        });

        it('should include clarification type and term in not found response', async () => {
            const tool = LookupPerson.create(mockContext);
            const result = await tool.execute({ name: 'NewPerson' });
      
            expect(result.success).toBe(true);
            expect(result.data.clarificationType).toBe('new_person');
            expect(result.data.term).toBe('NewPerson');
            expect(result.data.message).toContain('NewPerson');
        });
    });
  
    describe('lookup_project', () => {
        it('should return found when project exists', async () => {
            const projectResult = [
                { id: 'alpha', name: 'Project Alpha', type: 'project' }
            ];
            mockContext.contextInstance.search = vi.fn(() => projectResult);
            mockContext.contextInstance.searchWithContext = vi.fn(() => projectResult);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Alpha' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
        });
    
        it('should return not found when project does not exist', async () => {
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
        });
    
        it('should match trigger phrases when provided', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [{
                id: 'quarterly',
                name: 'Quarterly Planning',
                type: 'project',
                classification: {
                    context_type: 'work',
                    explicit_phrases: ['quarterly planning meeting'],
                },
                routing: { destination: '~/work', structure: 'month', filename_options: ['date'] },
            }]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ 
                name: 'planning', 
                triggerPhrase: 'quarterly planning meeting' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.matchedTrigger).toBe('quarterly planning meeting');
        });

        it('should not match trigger phrases when triggerPhrase not provided', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [{
                id: 'quarterly',
                name: 'Quarterly Planning',
                type: 'project',
                active: true,
            }]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ 
                name: 'planning'
            });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            // getAllProjects is now always called to provide options to the user
            expect(mockContext.contextInstance.getAllProjects).toHaveBeenCalled();
            expect(result.data.knownProjects).toHaveLength(1);
            expect(result.data.options).toBeDefined();
        });

        it('should handle project without explicit_phrases', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [{
                id: 'project',
                name: 'Test Project',
                type: 'project',
                classification: {
                    context_type: 'work'
                },
            }]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ 
                name: 'test', 
                triggerPhrase: 'test phrase' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
        });

        it('should handle multiple projects with trigger phrase match', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [
                {
                    id: 'project1',
                    name: 'First Project',
                    type: 'project',
                    classification: {
                        context_type: 'work',
                        explicit_phrases: ['first']
                    },
                },
                {
                    id: 'project2',
                    name: 'Matching Project',
                    type: 'project',
                    classification: {
                        context_type: 'work',
                        explicit_phrases: ['quarterly planning']
                    },
                }
            ]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ 
                name: 'test', 
                triggerPhrase: 'quarterly planning' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.project.id).toBe('project2');
        });

        it('should return cached result for already resolved entities', async () => {
            mockContext.resolvedEntities = new Map([['Alpha', 'Project Alpha']]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Alpha' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.cached).toBe(true);
            expect(result.data.suggestion).toContain('Already resolved');
            expect(result.data.suggestion).toContain('Project Alpha');
        });

        it('should skip ignored terms without prompting', async () => {
            mockContext.contextInstance.isIgnored = vi.fn(() => true);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'IgnoredTerm' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            expect(result.data.ignored).toBe(true);
            expect(result.data.message).toContain('ignore list');
        });

        it('should find project by sounds_like phonetic variant', async () => {
            // Mock findBySoundsLike to return a project
            mockContext.contextInstance.findBySoundsLike = vi.fn((phonetic: string) => {
                if (phonetic === 'protocol' || phonetic === 'pro to call') {
                    return {
                        id: 'protokoll',
                        name: 'Protokoll',
                        type: 'project',
                        classification: { context_type: 'work' },
                        routing: { destination: '~/work/protokoll', structure: 'month', filename_options: ['date'] },
                        sounds_like: ['protocol', 'pro to call', 'proto call'],
                    };
                }
                return undefined;
            });
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'protocol' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.project.name).toBe('Protokoll');
            expect(result.data.matchedVia).toBe('sounds_like');
        });

        it('should find Norwegian project by English phonetic transcription', async () => {
            // Simulates Whisper transcribing Norwegian "Kronologi" as "chronology"
            mockContext.contextInstance.findBySoundsLike = vi.fn((phonetic: string) => {
                if (phonetic.toLowerCase() === 'chronology') {
                    return {
                        id: 'kronologi',
                        name: 'Kronologi',
                        type: 'project',
                        classification: { context_type: 'work' },
                        routing: { destination: '~/work/kronologi', structure: 'month', filename_options: ['date'] },
                        sounds_like: ['chronology', 'crono logy', 'crow no logy'],
                    };
                }
                return undefined;
            });
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'chronology' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.project.name).toBe('Kronologi');
            expect(result.data.matchedVia).toBe('sounds_like');
        });

        it('should prefer exact project match over sounds_like match', async () => {
            // If there's an exact match in search, it should be used before sounds_like
            const searchFn = vi.fn((query: string) => {
                if (query.toLowerCase() === 'exact-match') {
                    return [{
                        id: 'exact-match',
                        name: 'Exact Match Project',
                        type: 'project',
                        classification: { context_type: 'work' },
                        routing: { destination: '~/work', structure: 'month', filename_options: ['date'] },
                    }];
                }
                return [];
            });
            mockContext.contextInstance.search = searchFn;
            mockContext.contextInstance.searchWithContext = searchFn;
            mockContext.contextInstance.findBySoundsLike = vi.fn(() => ({
                id: 'sounds-like-match',
                name: 'Sounds Like Match',
                type: 'project',
                classification: { context_type: 'work' },
                routing: { destination: '~/work', structure: 'month', filename_options: ['date'] },
            }));
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'exact-match' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.project.name).toBe('Exact Match Project');
            // findBySoundsLike should not be called when exact match is found
        });

        it('should fall back to sounds_like when no exact match found', async () => {
            // No exact match in search
            mockContext.contextInstance.search = vi.fn(() => []);
            // But sounds_like finds it
            mockContext.contextInstance.findBySoundsLike = vi.fn((phonetic: string) => {
                if (phonetic === 'observashun') {
                    return {
                        id: 'observasjon',
                        name: 'Observasjon',
                        type: 'project',
                        classification: { context_type: 'work' },
                        routing: { destination: '~/work/obs', structure: 'month', filename_options: ['date'] },
                        sounds_like: ['observation', 'observashun'],
                    };
                }
                return undefined;
            });
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'observashun' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(true);
            expect(result.data.project.name).toBe('Observasjon');
            expect(result.data.matchedVia).toBe('sounds_like');
        });

        it('should handle project sounds_like returning non-project entity gracefully', async () => {
            // findBySoundsLike returns a term (not a project)
            mockContext.contextInstance.search = vi.fn(() => []);
            mockContext.contextInstance.findBySoundsLike = vi.fn(() => ({
                id: 'some-term',
                name: 'Some Term',
                type: 'term',
                projects: ['associated-project'],
            }));
            mockContext.contextInstance.getAllProjects = vi.fn(() => [{
                id: 'associated-project',
                name: 'Associated Project',
                type: 'project',
                classification: { context_type: 'work' },
                routing: { destination: '~/work', structure: 'month', filename_options: ['date'] },
            }]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'some term' });
      
            expect(result.success).toBe(true);
            // Should find via term_sounds_like -> associated project
            expect(result.data.found).toBe(true);
            expect(result.data.matchedVia).toBe('term_sounds_like');
            expect(result.data.project.name).toBe('Associated Project');
        });

        it('should include transcript context in user prompt when term is found in transcript', async () => {
            mockContext.transcriptText = 'First sentence. The Alpha project is important. Third sentence.';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Alpha' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('Alpha');
        });

        it('should fallback to triggerPhrase in user prompt when term not found in transcript', async () => {
            mockContext.transcriptText = 'This transcript does not contain the term.';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ 
                name: 'UnknownProject', 
                triggerPhrase: 'mentioned something about work' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('Context from transcript:');
            expect(result.userPrompt).toContain('mentioned something about work');
        });

        it('should not include context in user prompt when neither term nor triggerPhrase available', async () => {
            mockContext.transcriptText = 'This transcript does not contain the term.';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'UnknownProject' });
      
            expect(result.success).toBe(true);
            expect(result.data.found).toBe(false);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).not.toContain('Context from transcript:');
        });

        it('should filter out inactive projects from options', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [
                { id: 'active', name: 'Active Project', type: 'project', active: true },
                { id: 'inactive', name: 'Inactive Project', type: 'project', active: false },
                { id: 'default', name: 'Default Project', type: 'project' }, // no active field
            ]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.knownProjects).toHaveLength(2);
            expect(result.data.options).toHaveLength(2);
            expect(result.data.options.some((o: string) => o.includes('Active Project'))).toBe(true);
            expect(result.data.options.some((o: string) => o.includes('Default Project'))).toBe(true);
            expect(result.data.options.some((o: string) => o.includes('Inactive Project'))).toBe(false);
        });

        it('should include project description in options when available', async () => {
            mockContext.contextInstance.getAllProjects = vi.fn(() => [
                { id: 'with-desc', name: 'Project A', description: 'A detailed description', type: 'project' },
                { id: 'without-desc', name: 'Project B', type: 'project' },
            ]);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.data.options).toHaveLength(2);
            expect(result.data.options[0]).toBe('Project A - A detailed description');
            expect(result.data.options[1]).toBe('Project B');
        });

        it('should extract filename from full path for user prompt', async () => {
            mockContext.sourceFile = '/path/to/audio/recording.m4a';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('File: recording.m4a');
            expect(result.userPrompt).not.toContain('/path/to/audio/');
        });

        it('should use full sourceFile when no path separator present', async () => {
            mockContext.sourceFile = 'simple-file.m4a';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('File: simple-file.m4a');
        });

        it('should fallback to sourceFile when path ends with separator', async () => {
            // Edge case: path ends with / so pop() returns empty string
            mockContext.sourceFile = '/path/to/directory/';
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            // Should fallback to full sourceFile when pop() returns empty
            expect(result.userPrompt).toContain('File:');
        });

        it('should include formatted date in user prompt', async () => {
            mockContext.audioDate = new Date('2026-03-15T14:30:00');
            mockContext.contextInstance.getAllProjects = vi.fn(() => []);
      
            const tool = LookupProject.create(mockContext);
            const result = await tool.execute({ name: 'Unknown' });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('Date:');
            expect(result.userPrompt).toContain('2026');
            expect(result.userPrompt).toContain('Mar');
            expect(result.userPrompt).toContain('15');
        });

        describe('transcript context extraction', () => {
            it('should extract context around term with sentence boundaries', async () => {
                mockContext.transcriptText = 'This is background. The Acme project needs attention. We should prioritize it.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Acme' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Acme');
            });

            it('should handle case-insensitive term matching', async () => {
                mockContext.transcriptText = 'Working on the ACME project today.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'acme' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
            });

            it('should handle term at start of transcript', async () => {
                mockContext.transcriptText = 'ProjectX is the main focus. We need to work on it.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'ProjectX' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('ProjectX');
            });

            it('should handle term at end of transcript', async () => {
                mockContext.transcriptText = 'The main focus is ProjectY';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'ProjectY' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('ProjectY');
            });

            it('should handle transcript with exclamation marks as boundaries', async () => {
                mockContext.transcriptText = 'Amazing news! The Beta project is ready! Lets celebrate.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Beta' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Beta');
            });

            it('should handle transcript with question marks as boundaries', async () => {
                mockContext.transcriptText = 'What happened? The Gamma project failed? We need answers.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Gamma' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Gamma');
            });

            it('should truncate very long context and keep sentence with term', async () => {
                // Create a transcript where the context around the term would be > 300 chars
                // Need: sentence before term + sentence with term + sentence after term > 300 chars
                // The extraction finds 2 sentence boundaries before and after
                const longSentence1 = 'This is the first very long sentence that contains a lot of words to make it quite lengthy. ';
                const longSentence2 = 'This is the second sentence which also has many words in it to add more length to the context. ';
                const termSentence = 'The Delta project is important. ';
                const longSentence3 = 'This is another long sentence after the term that adds even more characters to the total. ';
                const longSentence4 = 'And finally this last sentence pushes us well over three hundred characters total.';
                
                mockContext.transcriptText = longSentence1 + longSentence2 + termSentence + longSentence3 + longSentence4;
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Delta' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Delta');
            });

            it('should truncate and add ellipsis when term not found in extracted context', async () => {
                // Create a scenario where the term appears in transcript but the case-sensitive
                // indexOf in the truncation logic fails. This happens when the extracted context
                // no longer contains the exact term due to boundary calculations.
                // We need context > 300 chars but term at very edge where truncation excludes it
                const longContent = 'A'.repeat(320);
                mockContext.transcriptText = longContent + ' omega. ' + 'B'.repeat(50);
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'omega' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
            });

            it('should find sentence boundaries within long context when term is present', async () => {
                // Test the inner truncation logic (lines 65-87) that finds sentence boundaries
                // around the term when context > 300 chars and term IS found in extracted context
                // Need: extracted context > 300 chars with term inside and sentence boundaries around it
                const before = 'Introduction text. Some background. More details here. ';
                const middle = 'The Kappa project needs work. ';
                const after = 'Additional info. Conclusion text. Final notes here.';
                // Pad to ensure > 300 chars
                const padded = 'X'.repeat(150) + before + middle + after + 'Y'.repeat(150);
                mockContext.transcriptText = padded;
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Kappa' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Kappa');
            });

            it('should handle sentence start search when term is at beginning of long context', async () => {
                // Test case where the backwards search for sentence start reaches index 0
                // (lines 72-77 where sentenceStart stays at midPoint if no boundary found)
                // Create long context where term is near the start with no period before it
                const longNoBreak = 'X'.repeat(100) + ' ';
                const termPart = 'Lambda project details ';
                const afterPart = 'Y'.repeat(250) + '. End sentence.';
                mockContext.transcriptText = longNoBreak + termPart + afterPart;
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Lambda' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
            });

            it('should handle sentence end search when term is at end of long context', async () => {
                // Test case where the forwards search for sentence end reaches context end
                // (lines 80-85 where sentenceEnd stays at midPoint + term.length if no boundary found)
                const beforePart = 'Start sentence. ' + 'X'.repeat(250);
                const termPart = ' Mu project';
                const longNoBreak = ' ' + 'Y'.repeat(100);
                mockContext.transcriptText = beforePart + termPart + longNoBreak;
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Mu' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
            });

            it('should truncate with ellipsis when context is long and term differs in case', async () => {
                // Test line 90: the else branch where term is not found in extracted context
                // This happens when context.indexOf(term) returns -1 because:
                // 1. The extracted context > 300 chars
                // 2. The term's case differs from what's in the transcript
                // 3. The case-sensitive indexOf in truncation logic fails
                // 
                // Key: The initial search uses toLowerCase() but the truncation uses case-sensitive indexOf
                const longSentence = 'A'.repeat(200) + '. ';
                const termInContext = 'SIGMA project here. ';
                const moreLong = 'B'.repeat(200) + '.';
                mockContext.transcriptText = longSentence + termInContext + moreLong;
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                // Search with lowercase - will find due to case-insensitive search
                // But truncation's indexOf('sigma') won't find 'SIGMA' in the context
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'sigma' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                // Should see the ellipsis truncation
                expect(result.userPrompt).toContain('...');
            });

            it('should handle transcript without clear sentence boundaries', async () => {
                mockContext.transcriptText = 'working on the Epsilon project with the team today';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Epsilon' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Epsilon');
            });

            it('should handle multiple sentences before and after term', async () => {
                mockContext.transcriptText = 'First thing. Second thing. The Zeta project is here. Fourth thing. Fifth thing.';
                mockContext.contextInstance.getAllProjects = vi.fn(() => []);
        
                const tool = LookupProject.create(mockContext);
                const result = await tool.execute({ name: 'Zeta' });
        
                expect(result.success).toBe(true);
                expect(result.userPrompt).toContain('Context from transcript:');
                expect(result.userPrompt).toContain('Zeta');
            });
        });
    });
  
    describe('verify_spelling', () => {
        it('should return best guess in non-interactive mode with suggestion', async () => {
            const tool = VerifySpelling.create(mockContext);
            const result = await tool.execute({ 
                term: 'pria', 
                suggestedSpelling: 'Priya' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.spelling).toBe('Priya');
            expect(result.data.useSuggestion).toBe(true);
        });

        it('should return term itself in non-interactive mode without suggestion', async () => {
            const tool = VerifySpelling.create(mockContext);
            const result = await tool.execute({ 
                term: 'pria'
            });
      
            expect(result.success).toBe(true);
            expect(result.data.spelling).toBe('pria');
            expect(result.data.verified).toBe(false);
        });
    
        it('should request user input in interactive mode with suggestion', async () => {
            mockContext.interactiveMode = true;
      
            const tool = VerifySpelling.create(mockContext);
            const result = await tool.execute({ term: 'pria', suggestedSpelling: 'Priya' });
      
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('pria');
            expect(result.userPrompt).toContain('Priya');
        });

        it('should request user input in interactive mode without suggestion', async () => {
            mockContext.interactiveMode = true;
      
            const tool = VerifySpelling.create(mockContext);
            const result = await tool.execute({ term: 'pria' });
      
            expect(result.success).toBe(true);
            expect(result.needsUserInput).toBe(true);
            expect(result.userPrompt).toContain('pria');
            expect(result.userPrompt).not.toContain('Suggested');
        });

        it('should include context in user prompt when provided', async () => {
            mockContext.interactiveMode = true;
      
            const tool = VerifySpelling.create(mockContext);
            const result = await tool.execute({ 
                term: 'pria',
                context: 'Speaker context'
            });
      
            expect(result.success).toBe(true);
            expect(result.userPrompt).toContain('context:');
        });
    });
  
    describe('route_note', () => {
        it('should return routing decision', async () => {
            const tool = RouteNote.create(mockContext);
            const result = await tool.execute({ contentSummary: 'Test note' });
      
            expect(result.success).toBe(true);
            expect(result.data.routingDecision).toBeDefined();
            expect(result.data.outputPath).toBeDefined();
            expect(result.data.confidence).toBe(1.0);
        });
    });
  
    describe('store_context', () => {
        it('should acknowledge without persisting', async () => {
            const tool = StoreContext.create(mockContext);
            const result = await tool.execute({ 
                entityType: 'person', 
                name: 'New Person' 
            });
      
            expect(result.success).toBe(true);
            expect(result.data.stored).toBe(false);
            expect(result.data.message).toContain('--self-update');
        });
    });
});

describe('Tool Registry', () => {
    let mockContext: ToolContext;
  
    beforeEach(() => {
        mockContext = {
            transcriptText: 'Test',
            audioDate: new Date(),
            sourceFile: 'test.m4a',
            contextInstance: {
                search: vi.fn(() => []),
                findBySoundsLike: vi.fn(() => undefined),
                getAllProjects: vi.fn(() => []),
                // @ts-ignore
            },
            routingInstance: {
                route: vi.fn(() => ({ projectId: null, confidence: 1.0 })),
                buildOutputPath: vi.fn(() => '/tmp/test.md'),
                // @ts-ignore
            },
            interactiveMode: false,
        };
    });
  
    it('should create registry with all tools', async () => {
        const Registry = await import('../../src/agentic/registry');
        const registry = Registry.create(mockContext);
    
        const tools = registry.getTools();
        expect(tools.length).toBe(5);
        expect(tools.map(t => t.name)).toContain('lookup_person');
        expect(tools.map(t => t.name)).toContain('lookup_project');
        expect(tools.map(t => t.name)).toContain('verify_spelling');
        expect(tools.map(t => t.name)).toContain('route_note');
        expect(tools.map(t => t.name)).toContain('store_context');
    });
  
    it('should generate tool definitions for LLM', async () => {
        const Registry = await import('../../src/agentic/registry');
        const registry = Registry.create(mockContext);
    
        const definitions = registry.getToolDefinitions();
        expect(definitions.length).toBe(5);
        // Flat format - reasoning client handles OpenAI conversion
        expect(definitions[0].name).toBeDefined();
        expect(definitions[0].description).toBeDefined();
        expect(definitions[0].parameters).toBeDefined();
    });
  
    it('should execute tools by name', async () => {
        const Registry = await import('../../src/agentic/registry');
        const registry = Registry.create(mockContext);
    
        const result = await registry.executeTool('store_context', { 
            entityType: 'person', 
            name: 'Test' 
        });
    
        expect(result.success).toBe(true);
    });
  
    it('should return error for unknown tool', async () => {
        const Registry = await import('../../src/agentic/registry');
        const registry = Registry.create(mockContext);
    
        const result = await registry.executeTool('unknown_tool', {});
    
        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown tool');
    });
});

