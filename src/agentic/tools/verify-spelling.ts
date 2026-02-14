/**
 * Verify Spelling Tool
 * 
 * Requests user verification for an unknown name or term.
 */

import { TranscriptionTool, ToolContext, ToolResult } from '../types';

export const create = (ctx: ToolContext): TranscriptionTool => ({
    name: 'verify_spelling',
    description: 'Request user verification for an unknown name or term. Use when you encounter something that needs human confirmation.',
    parameters: {
        type: 'object',
        properties: {
            term: {
                type: 'string',
                description: 'The term that needs verification',
            },
            context: {
                type: 'string',
                description: 'Context around where this term appears',
            },
            suggestedSpelling: {
                type: 'string',
                description: 'Your best guess at the correct spelling',
            },
        },
        required: ['term'],
    },
    execute: async (args: { term: string; context?: string; suggestedSpelling?: string }): Promise<ToolResult> => {
        if (!ctx.interactiveMode) {
            // In batch mode, return best guess
            return {
                success: true,
                data: {
                    verified: false,
                    useSuggestion: true,
                    spelling: args.suggestedSpelling || args.term,
                    message: 'Non-interactive mode: using best guess',
                },
            };
        }
    
        // In interactive mode, mark for user input
        return {
            success: true,
            needsUserInput: true,
            userPrompt: `Unknown term: "${args.term}"${args.context ? ` (context: "${args.context}")` : ''}
${args.suggestedSpelling ? `Suggested spelling: "${args.suggestedSpelling}"` : ''}
Please provide the correct spelling:`,
            data: {
                term: args.term,
                suggestedSpelling: args.suggestedSpelling,
            },
        };
    },
});

