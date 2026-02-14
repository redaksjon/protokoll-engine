/**
 * Store Context Tool
 * 
 * Stores new context information for future use.
 */

import { TranscriptionTool, ToolContext, ToolResult } from '../types';

export const create = (_ctx: ToolContext): TranscriptionTool => ({
    name: 'store_context',
    description: 'Store new context information for future use. Use when you learn something new that should be remembered.',
    parameters: {
        type: 'object',
        properties: {
            entityType: {
                type: 'string',
                enum: ['person', 'project', 'company', 'term'],
                description: 'Type of entity to store',
            },
            name: {
                type: 'string',
                description: 'Name of the entity',
            },
            details: {
                type: 'object',
                description: 'Additional details about the entity',
            },
        },
        required: ['entityType', 'name'],
    },
     
    execute: async (args: { entityType: string; name: string; details?: any }): Promise<ToolResult> => {
        // This tool requires --self-update flag to actually persist
        // Otherwise it just acknowledges without saving
    
        return {
            success: true,
            data: {
                stored: false,
                message: 'Context storage requires --self-update flag. Information noted but not persisted.',
                entityType: args.entityType,
                name: args.name,
            },
        };
    },
});

