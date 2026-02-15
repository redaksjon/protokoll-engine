/**
 * Feedback Operations
 * 
 * Core business logic for processing natural language feedback on transcripts.
 * Extracted from CLI to provide reusable functions for MCP tools.
 */

import * as fs from 'fs/promises';
import * as path from 'node:path';
import * as Context from '@redaksjon/context';
import * as Reasoning from '../reasoning';
import * as Logging from '../logging';
import { slugifyTitle, extractTimestampFromFilename } from './operations';
import { PklTranscript } from '@redaksjon/protokoll-format';
import { ensurePklExtension } from './pkl-utils';

/**
 * Tool definitions for feedback processor
 */
export interface FeedbackTool {
    name: string;
    description: string;
    parameters: Record<string, {
        type: string;
        description: string;
        required?: boolean;
        enum?: string[];
        items?: { type: string };
    }>;
}

export const FEEDBACK_TOOLS: FeedbackTool[] = [
    {
        name: 'correct_text',
        description: 'Replace text in the transcript. Use this to fix misspellings, wrong terms, or incorrect names.',
        parameters: {
            find: { type: 'string', description: 'The text to find in the transcript', required: true },
            replace: { type: 'string', description: 'The text to replace it with', required: true },
            replace_all: { type: 'boolean', description: 'Replace all occurrences (default: true)' },
        },
    },
    {
        name: 'add_term',
        description: 'Add a new term to the context so it will be recognized in future transcripts.',
        parameters: {
            term: { type: 'string', description: 'The correct term/abbreviation', required: true },
            definition: { type: 'string', description: 'What the term means', required: true },
            sounds_like: { type: 'array', items: { type: 'string' }, description: 'Phonetic variations' },
            context: { type: 'string', description: 'Additional context about when this term is used' },
        },
    },
    {
        name: 'add_person',
        description: 'Add a new person to the context for future name recognition.',
        parameters: {
            name: { type: 'string', description: 'The correct full name', required: true },
            sounds_like: { type: 'array', items: { type: 'string' }, description: 'Phonetic variations', required: true },
            role: { type: 'string', description: 'Their role or title' },
            company: { type: 'string', description: 'Company they work for' },
            context: { type: 'string', description: 'Additional context about this person' },
        },
    },
    {
        name: 'change_project',
        description: 'Change the project assignment of this transcript.',
        parameters: {
            project_id: { type: 'string', description: 'The project ID to assign', required: true },
        },
    },
    {
        name: 'change_title',
        description: 'Change the title of this transcript.',
        parameters: {
            new_title: { type: 'string', description: 'The new title for the transcript', required: true },
        },
    },
    {
        name: 'provide_help',
        description: 'Provide helpful information to the user about what kinds of feedback they can give.',
        parameters: {
            topic: { type: 'string', description: 'The topic to help with', enum: ['terms', 'people', 'projects', 'corrections', 'general'] },
        },
    },
    {
        name: 'complete',
        description: 'Call this when you have finished processing all the feedback.',
        parameters: {
            summary: { type: 'string', description: 'A summary of what was done', required: true },
        },
    },
];

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
}

/**
 * Feedback processing context
 */
export interface FeedbackContext {
    transcriptPath: string;
    transcriptContent: string;
    originalContent: string;
    context: Context.ContextInstance;
    changes: FeedbackChange[];
    verbose: boolean;
    dryRun: boolean;
}

export interface FeedbackChange {
    type: 'text_correction' | 'term_added' | 'person_added' | 'project_changed' | 'title_changed';
    description: string;
    details: Record<string, unknown>;
}

/**
 * Execute a feedback tool
 */
export const executeTool = async (
    toolName: string,
    args: Record<string, unknown>,
    feedbackCtx: FeedbackContext
): Promise<ToolResult> => {
    const logger = Logging.getLogger();
    
    switch (toolName) {
        case 'correct_text': {
            const find = String(args.find);
            const replace = String(args.replace);
            const replaceAll = args.replace_all !== false;
            
            if (!feedbackCtx.transcriptContent.includes(find)) {
                return {
                    success: false,
                    message: `Text "${find}" not found in transcript.`,
                };
            }
            
            const occurrences = feedbackCtx.transcriptContent.split(find).length - 1;
            
            if (replaceAll) {
                feedbackCtx.transcriptContent = feedbackCtx.transcriptContent.split(find).join(replace);
            } else {
                feedbackCtx.transcriptContent = feedbackCtx.transcriptContent.replace(find, replace);
            }
            
            const changeCount = replaceAll ? occurrences : 1;
            
            feedbackCtx.changes.push({
                type: 'text_correction',
                description: `Replaced "${find}" with "${replace}" (${changeCount} occurrence${changeCount > 1 ? 's' : ''})`,
                details: { find, replace, count: changeCount },
            });
            
            return {
                success: true,
                message: `Replaced ${changeCount} occurrence(s) of "${find}" with "${replace}".`,
            };
        }
        
        case 'add_term': {
            const term = String(args.term);
            const definition = String(args.definition);
            const soundsLike = args.sounds_like as string[] | undefined;
            const termContext = args.context as string | undefined;
            
            const id = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            
            const existing = feedbackCtx.context.getTerm(id);
            if (existing) {
                return {
                    success: false,
                    message: `Term "${term}" already exists in context.`,
                };
            }
            
            const newTerm: Context.Term = {
                id,
                name: term,
                type: 'term',
                expansion: definition,
                sounds_like: soundsLike,
                domain: termContext,
            };
            
            if (!feedbackCtx.dryRun) {
                await feedbackCtx.context.saveEntity(newTerm);
            }
            
            feedbackCtx.changes.push({
                type: 'term_added',
                description: `Added term "${term}" to context`,
                details: { term, definition, sounds_like: soundsLike },
            });
            
            return {
                success: true,
                message: `Added term "${term}" to context.`,
                data: { id, term, definition },
            };
        }
        
        case 'add_person': {
            const name = String(args.name);
            const soundsLike = args.sounds_like as string[];
            const role = args.role as string | undefined;
            const company = args.company as string | undefined;
            const personContext = args.context as string | undefined;
            
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            
            const existing = feedbackCtx.context.getPerson(id);
            if (existing) {
                return {
                    success: false,
                    message: `Person "${name}" already exists in context.`,
                };
            }
            
            const newPerson: Context.Person = {
                id,
                name,
                type: 'person',
                sounds_like: soundsLike,
                role,
                company,
                context: personContext,
            };
            
            if (!feedbackCtx.dryRun) {
                await feedbackCtx.context.saveEntity(newPerson);
            }
            
            feedbackCtx.changes.push({
                type: 'person_added',
                description: `Added person "${name}" to context`,
                details: { name, sounds_like: soundsLike, role, company },
            });
            
            return {
                success: true,
                message: `Added person "${name}" to context.`,
                data: { id, name, sounds_like: soundsLike },
            };
        }
        
        case 'change_project': {
            const projectId = String(args.project_id);
            
            const project = feedbackCtx.context.getProject(projectId);
            if (!project) {
                const available = feedbackCtx.context.getAllProjects().map(p => p.id);
                return {
                    success: false,
                    message: `Project "${projectId}" not found. Available: ${available.join(', ')}`,
                };
            }
            
            const metadataRegex = /\*\*Project\*\*: .+/;
            const projectIdRegex = /\*\*Project ID\*\*: `.+`/;
            
            if (metadataRegex.test(feedbackCtx.transcriptContent)) {
                feedbackCtx.transcriptContent = feedbackCtx.transcriptContent.replace(
                    metadataRegex,
                    `**Project**: ${project.name}`
                );
            }
            
            if (projectIdRegex.test(feedbackCtx.transcriptContent)) {
                feedbackCtx.transcriptContent = feedbackCtx.transcriptContent.replace(
                    projectIdRegex,
                    `**Project ID**: \`${project.id}\``
                );
            }
            
            feedbackCtx.changes.push({
                type: 'project_changed',
                description: `Changed project to "${project.name}" (${project.id})`,
                details: { project_id: projectId, project_name: project.name, routing: project.routing },
            });
            
            return {
                success: true,
                message: `Changed project to "${project.name}".`,
                data: { project_id: projectId, destination: project.routing?.destination },
            };
        }
        
        case 'change_title': {
            const newTitle = String(args.new_title);
            
            // For PKL format, title is stored in metadata, not in content
            // We just track the change here - applyChanges will update the PKL metadata
            feedbackCtx.changes.push({
                type: 'title_changed',
                description: `Changed title to "${newTitle}"`,
                details: { new_title: newTitle, slug: slugifyTitle(newTitle) },
            });
            
            return {
                success: true,
                message: `Changed title to "${newTitle}".`,
                data: { new_title: newTitle },
            };
        }
        
        case 'provide_help': {
            const topic = String(args.topic || 'general');
            let helpText = '';
            
            switch (topic) {
                case 'terms':
                    helpText = 'You can teach me about abbreviations, acronyms, and technical terms.';
                    break;
                case 'people':
                    helpText = 'You can teach me about people whose names were transcribed incorrectly.';
                    break;
                case 'projects':
                    helpText = 'You can tell me if a transcript belongs to a different project.';
                    break;
                case 'corrections':
                    helpText = 'You can ask me to fix any text in the transcript.';
                    break;
                default:
                    helpText = 'I can help with terms, names, projects, and general corrections.';
            }
            
            return {
                success: true,
                message: helpText,
            };
        }
        
        case 'complete': {
            const summary = String(args.summary);
            return {
                success: true,
                message: summary,
                data: { complete: true },
            };
        }
        
        default:
            logger.warn('Unknown tool: %s', toolName);
            return {
                success: false,
                message: `Unknown tool: ${toolName}`,
            };
    }
};

/**
 * Build system prompt for feedback agent
 */
export const buildFeedbackSystemPrompt = (
    transcriptPreview: string,
    availableProjects: string[]
): string => {
    const toolDescriptions = FEEDBACK_TOOLS.map(t => 
        `- ${t.name}: ${t.description}`
    ).join('\n');
    
    return `You are an intelligent feedback processor for a transcription system.

## Current Transcript Preview
${transcriptPreview.substring(0, 1000)}${transcriptPreview.length > 1000 ? '...' : ''}

## Available Projects
${availableProjects.length > 0 ? availableProjects.join(', ') : '(no projects configured)'}

## Available Tools
${toolDescriptions}

## Rules
- Understand the feedback and identify necessary actions
- Execute tools in order: text corrections, then context entities, then metadata
- Always call 'complete' when finished with a summary
- For name/term corrections: BOTH fix the text AND add to context`;
};

/**
 * Process feedback using agentic model
 */
export const processFeedback = async (
    feedback: string,
    feedbackCtx: FeedbackContext,
    reasoning: Reasoning.ReasoningInstance
): Promise<void> => {
    const logger = Logging.getLogger();
    
    const projects = feedbackCtx.context.getAllProjects().map(p => `${p.id} (${p.name})`);
    const systemPrompt = buildFeedbackSystemPrompt(feedbackCtx.transcriptContent, projects);
    
    const tools = FEEDBACK_TOOLS.map(t => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: {
                type: 'object',
                properties: Object.fromEntries(
                    Object.entries(t.parameters).map(([key, param]) => [
                        key,
                        {
                            type: param.type,
                            description: param.description,
                            ...(param.enum ? { enum: param.enum } : {}),
                            ...(param.items ? { items: param.items } : {}),
                        },
                    ])
                ),
                required: Object.entries(t.parameters)
                    .filter(([_, p]) => p.required)
                    .map(([key]) => key),
            },
        },
    }));
    
    let iterations = 0;
    const maxIterations = 10;
    const conversationHistory: Array<{
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: feedback },
    ];
    
    while (iterations < maxIterations) {
        iterations++;
        logger.debug('Feedback processing iteration %d', iterations);
        
        try {
            const response = await reasoning.completeWithTools({
                messages: conversationHistory,
                tools,
            });
            
            if (response.tool_calls && response.tool_calls.length > 0) {
                conversationHistory.push({
                    role: 'assistant',
                    content: response.content || '',
                    tool_calls: response.tool_calls.map(tc => ({
                        id: tc.id,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    })),
                });
                
                for (const toolCall of response.tool_calls) {
                    const toolName = toolCall.function.name;
                    let args: Record<string, unknown>;
                    
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch {
                        args = {};
                    }
                    
                    const result = await executeTool(toolName, args, feedbackCtx);
                    
                    conversationHistory.push({
                        role: 'tool',
                        content: JSON.stringify(result),
                        tool_call_id: toolCall.id,
                    });
                    
                    if (toolName === 'complete') {
                        return;
                    }
                }
            } else {
                return;
            }
        } catch (error) {
            logger.error('Error during feedback processing', { error });
            throw error;
        }
    }
    
    logger.warn('Feedback processing reached max iterations');
};

/**
 * Apply changes and save transcript
 */
export const applyChanges = async (
    feedbackCtx: FeedbackContext
): Promise<{ newPath: string; moved: boolean }> => {
    const logger = Logging.getLogger();
    
    // Ensure we're working with PKL files
    const pklPath = ensurePklExtension(feedbackCtx.transcriptPath);
    let newPath = pklPath;
    let moved = false;
    
    const titleChange = feedbackCtx.changes.find(c => c.type === 'title_changed');
    if (titleChange) {
        const slug = titleChange.details.slug as string;
        const timestamp = extractTimestampFromFilename(pklPath);
        const dir = path.dirname(pklPath);
        
        if (timestamp) {
            const timeStr = `${timestamp.hour.toString().padStart(2, '0')}${timestamp.minute.toString().padStart(2, '0')}`;
            newPath = path.join(dir, `${timestamp.day}-${timeStr}-${slug}.pkl`);
        } else {
            newPath = path.join(dir, `${slug}.pkl`);
        }
    }
    
    const projectChange = feedbackCtx.changes.find(c => c.type === 'project_changed');
    if (projectChange && projectChange.details.routing) {
        const routing = projectChange.details.routing as { destination?: string; structure?: string };
        if (routing.destination) {
            let dest = routing.destination;
            if (dest.startsWith('~')) {
                dest = path.join(process.env.HOME || '', dest.slice(1));
            }
            
            const now = new Date();
            const year = now.getFullYear().toString();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            
            let structuredPath = dest;
            const structure = routing.structure || 'month';
            if (structure === 'year') {
                structuredPath = path.join(dest, year);
            } else if (structure === 'month') {
                structuredPath = path.join(dest, year, month);
            } else if (structure === 'day') {
                const day = now.getDate().toString().padStart(2, '0');
                structuredPath = path.join(dest, year, month, day);
            }
            
            const filename = path.basename(newPath);
            newPath = path.join(structuredPath, filename);
            moved = true;
        }
    }
    
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    
    if (!feedbackCtx.dryRun) {
        // Open the PKL transcript and apply changes
        const transcript = PklTranscript.open(pklPath, { readOnly: false });
        try {
            // Update content if it was modified
            if (feedbackCtx.transcriptContent !== feedbackCtx.originalContent) {
                transcript.updateContent(feedbackCtx.transcriptContent);
            }
            
            // Update title if it was changed
            if (titleChange) {
                transcript.updateMetadata({ title: titleChange.details.new_title as string });
            }
            
            // Update project if it was changed
            if (projectChange) {
                transcript.updateMetadata({ 
                    projectId: projectChange.details.project_id as string,
                    project: projectChange.details.project_name as string,
                });
            }
        } finally {
            transcript.close();
        }
        
        // Move file if path changed
        if (newPath !== pklPath) {
            await fs.copyFile(pklPath, newPath);
            await fs.unlink(pklPath);
        }
    }
    
    logger.info('Applied %d changes to transcript', feedbackCtx.changes.length);
    
    return { newPath, moved };
};
