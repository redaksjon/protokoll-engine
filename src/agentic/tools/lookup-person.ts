/**
 * Lookup Person Tool
 * 
 * Looks up information about a person mentioned in the transcript.
 */

import { TranscriptionTool, ToolContext, ToolResult } from '../types';

/**
 * Extract context from transcript around where a name is mentioned.
 * Returns approximately one sentence before and after the name mention.
 */
function extractNameContext(transcript: string, name: string): string | null {
    // Case-insensitive search for the name
    const lowerTranscript = transcript.toLowerCase();
    const lowerName = name.toLowerCase();
    const index = lowerTranscript.indexOf(lowerName);
    
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
    for (let i = index + name.length; i < transcript.length; i++) {
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
        const midPoint = context.indexOf(name);
        if (midPoint !== -1) {
            // Keep the sentence with the name, trim around it
            let sentenceStart = midPoint;
            let sentenceEnd = midPoint + name.length;
            
            // Find sentence start
            for (let i = midPoint - 1; i >= 0; i--) {
                if (sentenceBoundary.test(context[i])) {
                    sentenceStart = i + 1;
                    break;
                }
            }
            
            // Find sentence end
            for (let i = midPoint + name.length; i < context.length; i++) {
                if (sentenceBoundary.test(context[i])) {
                    sentenceEnd = i + 1;
                    break;
                }
            }
            
            context = context.substring(sentenceStart, sentenceEnd).trim();
        } else {
            // Just truncate if name not found in extracted context
            context = context.substring(0, 300) + '...';
        }
    }
    
    return context;
}

export const create = (ctx: ToolContext): TranscriptionTool => ({
    name: 'lookup_person',
    description: 'Look up information about a person mentioned in the transcript. Use when you encounter a name that might need spelling verification or additional context.',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'The name to look up (as heard in transcript)',
            },
            phonetic: {
                type: 'string',
                description: 'How the name sounds (for alias matching)',
            },
        },
        required: ['name'],
    },
    execute: async (args: { name: string; phonetic?: string }): Promise<ToolResult> => {
        const context = ctx.contextInstance;
    
        // First, check if this person was already resolved in this session
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
    
        // Try direct name search
        const people = context.search(args.name);
        const personMatches = people.filter(e => e.type === 'person');
    
        if (personMatches.length > 0) {
            return {
                success: true,
                data: {
                    found: true,
                    person: personMatches[0],
                    suggestion: `Use "${personMatches[0].name}" for correct spelling`,
                },
            };
        }
    
        // Try phonetic match (sounds_like)
        if (args.phonetic) {
            const person = context.findBySoundsLike(args.phonetic);
            if (person) {
                return {
                    success: true,
                    data: {
                        found: true,
                        person,
                        suggestion: `"${args.phonetic}" likely refers to "${person.name}"`,
                    },
                };
            }
        }
    
        // Not found - always signal that we need user input
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
        
        // Find context from transcript where the name is mentioned
        const transcriptContext = extractNameContext(ctx.transcriptText, args.name);
        
        const promptLines = [
            `File: ${fileName}`,
            `Date: ${fileDate}`,
            '',
            `Unknown person mentioned: "${args.name}"`,
        ];
        
        if (transcriptContext) {
            promptLines.push('');
            promptLines.push('Context from transcript:');
            promptLines.push(`"${transcriptContext}"`);
        }
        
        return {
            success: true,
            needsUserInput: true,
            userPrompt: promptLines.join('\n'),
            data: {
                found: false,
                clarificationType: 'new_person',
                term: args.name,
                message: `Person "${args.name}" not found. Asking user for details.`,
                knownProjects: allProjects.filter(p => p.active !== false),
                options: projectOptions,
            },
        };
    },
});

