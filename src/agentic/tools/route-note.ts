/**
 * Route Note Tool
 * 
 * Determines the destination for a note based on content analysis.
 */

import { TranscriptionTool, ToolContext, ToolResult } from '../types';

export const create = (ctx: ToolContext): TranscriptionTool => ({
    name: 'route_note',
    description: 'Determine the destination for this note based on content analysis.',
    parameters: {
        type: 'object',
        properties: {
            projectHint: {
                type: 'string',
                description: 'The detected project name or hint',
            },
            contentSummary: {
                type: 'string',
                description: 'Brief summary of what the note is about',
            },
        },
    },
    execute: async (args: { projectHint?: string; contentSummary?: string }): Promise<ToolResult> => {
        const routing = ctx.routingInstance;
    
        const routingContext = {
            transcriptText: ctx.transcriptText,
            audioDate: ctx.audioDate,
            sourceFile: ctx.sourceFile,
        };
    
        const decision = routing.route(routingContext);
        const outputPath = routing.buildOutputPath(decision, routingContext);
    
        return {
            success: true,
            data: {
                projectId: decision.projectId,
                // Return the routing decision (base path + structure), NOT the built output path
                // The orchestrator will call buildOutputPath() later
                routingDecision: decision,
                // Also include the built path for informational purposes
                outputPath: outputPath,
                confidence: decision.confidence,
                reasoning: decision.reasoning,
                projectHint: args.projectHint,
                contentSummary: args.contentSummary,
            },
        };
    },
});

