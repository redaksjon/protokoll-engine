/**
 * Lookup Project Tool
 * 
 * Looks up project information for routing and context.
 * Prompts to create unknown projects when user input is available.
 */

import { TranscriptionTool, ToolContext, ToolResult } from '../types';

/**
 * Extract context from transcript around where a term is mentioned.
 * Returns approximately one sentence before and after the term mention.
 */
function extractTermContext(transcript: string, term: string): string | null {
    // Case-insensitive search for the term
    const lowerTranscript = transcript.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const index = lowerTranscript.indexOf(lowerTerm);
    
    if (index === -1) {
        return null;
    }
    
    // Define strong sentence boundaries (., !, ?)
    const sentenceBoundary = /[.!?]/;
    
    // Look backwards for the start (find the sentence boundary 1 sentence before)
    let startIndex = 0;
    let boundariesFound = 0;
    for (let i = index - 1; i >= 0; i--) {
        if (sentenceBoundary.test(transcript[i])) {
            boundariesFound++;
            // After finding first boundary (end of current sentence), 
            // keep looking for the second (end of previous sentence)
            if (boundariesFound === 2) {
                // Start after this boundary
                startIndex = i + 1;
                break;
            }
        }
    }
    
    // Look forwards for the end (find sentence boundary 1 sentence after)
    let endIndex = transcript.length;
    boundariesFound = 0;
    for (let i = index + term.length; i < transcript.length; i++) {
        if (sentenceBoundary.test(transcript[i])) {
            boundariesFound++;
            // After finding first boundary (end of current sentence),
            // keep looking for the second (end of next sentence)
            if (boundariesFound === 2) {
                // Include this boundary
                endIndex = i + 1;
                break;
            }
        }
    }
    
    // Extract and clean up the context
    let context = transcript.substring(startIndex, endIndex).trim();
    
    // Limit length to avoid overwhelming the prompt (max ~300 chars)
    if (context.length > 300) {
        // Try to cut at a sentence boundary
        const midPoint = context.indexOf(term);
        if (midPoint !== -1) {
            // Keep the sentence with the term, trim around it
            let sentenceStart = midPoint;
            let sentenceEnd = midPoint + term.length;
            
            // Find sentence start
            for (let i = midPoint - 1; i >= 0; i--) {
                if (sentenceBoundary.test(context[i])) {
                    sentenceStart = i + 1;
                    break;
                }
            }
            
            // Find sentence end
            for (let i = midPoint + term.length; i < context.length; i++) {
                if (sentenceBoundary.test(context[i])) {
                    sentenceEnd = i + 1;
                    break;
                }
            }
            
            context = context.substring(sentenceStart, sentenceEnd).trim();
        } else {
            // Just truncate if term not found in extracted context
            context = context.substring(0, 300) + '...';
        }
    }
    
    return context;
}

export const create = (ctx: ToolContext): TranscriptionTool => ({
    name: 'lookup_project',
    description: 'Look up project information for routing and context. Use when you need to determine where this note should be filed.',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'The project name or identifier',
            },
            triggerPhrase: {
                type: 'string',
                description: 'A phrase from the transcript that might indicate the project',
            },
        },
        required: ['name'],
    },
    execute: async (args: { name: string; triggerPhrase?: string }): Promise<ToolResult> => {
        const context = ctx.contextInstance;
    
        // First, check if this project/term was already resolved in this session
        if (ctx.resolvedEntities?.has(args.name)) {
            const resolvedName = ctx.resolvedEntities.get(args.name);
            return {
                success: true,
                data: {
                    found: true,
                    suggestion: `Already resolved: use "${resolvedName}"`,
                    cached: true,
                },
            };
        }
        
        // Check if this term is on the ignore list
        if (context.isIgnored(args.name)) {
            return {
                success: true,
                data: {
                    found: false,
                    ignored: true,
                    message: `"${args.name}" is on the ignore list - skipping without prompting`,
                },
            };
        }
        
        // Try to determine context from routing instance if available
        let contextProjectId: string | undefined;
        if (ctx.routingInstance) {
            const allProjects = context.getAllProjects();
            // Use the first active project as a context hint (could be improved)
            const activeProject = allProjects.find(p => p.active !== false);
            contextProjectId = activeProject?.id;
        }
    
        // Use context-aware search (prefers related projects)
        const searchResults = context.searchWithContext(args.name, contextProjectId);
        const projectMatches = searchResults.filter(e => e.type === 'project');
        const termMatches = searchResults.filter(e => e.type === 'term');
    
        if (projectMatches.length > 0) {
            const project = projectMatches[0];
            return {
                success: true,
                data: {
                    found: true,
                    project,
                    matchedVia: 'context_aware_search',
                },
            };
        }
        
        // Check if we found a term that's associated with projects
        if (termMatches.length > 0) {
            const term = termMatches[0];
            const termProjects = term.projects || [];
            
            if (termProjects.length > 0) {
                // Get the first associated project
                const allProjects = context.getAllProjects();
                const associatedProject = allProjects.find(p => p.id === termProjects[0]);
                
                if (associatedProject) {
                    return {
                        success: true,
                        data: {
                            found: true,
                            project: associatedProject,
                            matchedVia: 'term',
                            termName: term.name,
                        },
                    };
                }
            }
        }
        
        // Try findBySoundsLike as a fallback for exact phonetic matches
        const soundsLikeMatch = context.findBySoundsLike(args.name);
        if (soundsLikeMatch) {
            if (soundsLikeMatch.type === 'project') {
                return {
                    success: true,
                    data: {
                        found: true,
                        project: soundsLikeMatch,
                        matchedVia: 'sounds_like',
                    },
                };
            } else if (soundsLikeMatch.type === 'term') {
                const termProjects = soundsLikeMatch.projects || [];
                
                if (termProjects.length > 0) {
                    const allProjects = context.getAllProjects();
                    const associatedProject = allProjects.find(p => p.id === termProjects[0]);
                    
                    if (associatedProject) {
                        return {
                            success: true,
                            data: {
                                found: true,
                                project: associatedProject,
                                matchedVia: 'term_sounds_like',
                                termName: soundsLikeMatch.name,
                            },
                        };
                    }
                }
            }
        }
    
        // Try getting all projects and matching trigger phrases
        if (args.triggerPhrase) {
            const allProjects = context.getAllProjects();
            for (const project of allProjects) {
                const phrases = project.classification?.explicit_phrases ?? [];
                if (phrases.some(p => args.triggerPhrase?.toLowerCase().includes(p.toLowerCase()))) {
                    return {
                        success: true,
                        data: {
                            found: true,
                            project,
                            matchedTrigger: args.triggerPhrase,
                        },
                    };
                }
            }
        }
    
        // Project not found - always signal that we need user input
        // The executor will decide whether to actually prompt based on handler availability
        const allProjects = context.getAllProjects();
        const projectOptions = allProjects
            .filter(p => p.active !== false)
            .map(p => `${p.name}${p.description ? ` - ${p.description}` : ''}`);
        
        // Extract filename from sourceFile path for cleaner display
        const fileName = ctx.sourceFile.split('/').pop() || ctx.sourceFile;
        const fileDate = ctx.audioDate.toLocaleString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
        
        // Find context from transcript where the project/term is mentioned
        const transcriptContext = extractTermContext(ctx.transcriptText, args.name);
        
        const contextLines = [
            `File: ${fileName}`,
            `Date: ${fileDate}`,
            '',
            `Unknown project/term: "${args.name}"`,
        ];
        
        if (transcriptContext) {
            contextLines.push('');
            contextLines.push('Context from transcript:');
            contextLines.push(`"${transcriptContext}"`);
        } else if (args.triggerPhrase) {
            contextLines.push('');
            contextLines.push('Context from transcript:');
            contextLines.push(`"${args.triggerPhrase}"`);
        }
        
        return {
            success: true,
            needsUserInput: true,
            userPrompt: contextLines.join('\n'),
            data: {
                found: false,
                clarificationType: 'new_project',
                term: args.name,
                triggerPhrase: args.triggerPhrase,
                message: `Project "${args.name}" not found. Asking user if this is a new project.`,
                knownProjects: allProjects.filter(p => p.active !== false),
                options: projectOptions,
            },
        };
    },
});

