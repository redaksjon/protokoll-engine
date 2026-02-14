/**
 * Tool Registry
 * 
 * Manages available tools for agentic transcription.
 * Uses RiotPrompt's ToolRegistry for format conversion while
 * preserving protokoll's custom ToolResult interface.
 */

import { ToolRegistry } from '@kjerneverk/riotprompt';
import type { Tool as RiotTool } from '@kjerneverk/riotprompt';
import { TranscriptionTool, ToolContext, ToolResult } from './types';
import * as LookupPerson from './tools/lookup-person';
import * as LookupProject from './tools/lookup-project';
import * as VerifySpelling from './tools/verify-spelling';
import * as RouteNote from './tools/route-note';
import * as StoreContext from './tools/store-context';

export interface RegistryInstance {
    getTools(): TranscriptionTool[];
     
    getToolDefinitions(): any[];  // For LLM API format (OpenAI compatible)
     
    executeTool(name: string, args: any): Promise<ToolResult>;
    
    /** Get the underlying RiotPrompt ToolRegistry */
    getRiotRegistry(): ToolRegistry;
}

/**
 * Convert a protokoll TranscriptionTool to a RiotPrompt Tool.
 * The execute function is adapted to work with both systems.
 */
const toRiotTool = (tool: TranscriptionTool, category?: string): RiotTool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as RiotTool['parameters'],
    category,
    cost: 'cheap',
    execute: async (params: any) => {
        const result = await tool.execute(params);
        return result;
    },
});

export const create = (ctx: ToolContext): RegistryInstance => {
    // Create protokoll tools
    const tools: TranscriptionTool[] = [
        LookupPerson.create(ctx),
        LookupProject.create(ctx),
        VerifySpelling.create(ctx),
        RouteNote.create(ctx),
        StoreContext.create(ctx),
    ];
  
    const toolMap = new Map(tools.map(t => [t.name, t]));
    
    // Create RiotPrompt ToolRegistry for format conversion
    const riotRegistry = ToolRegistry.create();
    
    // Register tools with categories
    riotRegistry.register(toRiotTool(tools[0], 'lookup'));       // lookup_person
    riotRegistry.register(toRiotTool(tools[1], 'lookup'));       // lookup_project
    riotRegistry.register(toRiotTool(tools[2], 'verification')); // verify_spelling
    riotRegistry.register(toRiotTool(tools[3], 'routing'));      // route_note
    riotRegistry.register(toRiotTool(tools[4], 'storage'));      // store_context
  
    return {
        getTools: () => tools,
    
        // Use RiotPrompt's OpenAI format export
        getToolDefinitions: () => riotRegistry.toOpenAIFormat().map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        })),
         
        executeTool: async (name: string, args: any): Promise<ToolResult> => {
            const tool = toolMap.get(name);
            if (!tool) {
                return {
                    success: false,
                    error: `Unknown tool: ${name}`,
                };
            }
            return tool.execute(args);
        },
        
        getRiotRegistry: () => riotRegistry,
    };
};

