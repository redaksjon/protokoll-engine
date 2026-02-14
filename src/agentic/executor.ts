/**
 * Agentic Executor
 * 
 * Executes the agentic transcription loop with tool calls.
 * Uses RiotPrompt's ConversationBuilder for conversation management.
 */

import { ToolContext, TranscriptionState } from './types';
import * as Registry from './registry';
import * as Reasoning from '../reasoning';
import * as Logging from '../logging';
import { ConversationBuilder, ToolCall as RiotToolCall } from '@kjerneverk/riotprompt';

export interface ContextChangeRecord {
    entityType: 'person' | 'project' | 'company' | 'term' | 'ignored';
    entityId: string;
    entityName: string;
    action: 'created' | 'updated';
    details?: Record<string, unknown>;
}

export interface ExecutorInstance {
    process(transcriptText: string): Promise<{
        enhancedText: string;
        state: TranscriptionState;
        toolsUsed: string[];
        iterations: number;
        totalTokens?: number;
        contextChanges?: ContextChangeRecord[];
    }>;
}

/**
 * Convert internal tool call format to RiotPrompt's ToolCall format
 */
const toRiotToolCalls = (toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): RiotToolCall[] => {
    return toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
        },
    }));
};

/**
 * Clean response content by removing any leaked internal processing information
 * that should never appear in the user-facing transcript.
 */
const cleanResponseContent = (content: string): string => {
    // Remove common patterns of leaked internal processing
    // Pattern 1: "Using tools to..." type commentary
    let cleaned = content.replace(/^(?:Using tools?|Let me|I'll|I will|Now I'll|First,?\s*I(?:'ll| will)).*?[\r\n]+/gim, '');
    
    // Pattern 2: JSON tool call artifacts - match complete JSON objects with "tool" key
    // Matches: {"tool":"...","args":{...}}, {"tool":"...","input":{...}}, etc.
    // Use a more careful pattern that matches balanced braces
    cleaned = cleaned.replace(/\{"tool":\s*"[^"]+",\s*"(?:args|input)":\s*\{[^}]*\}\}/g, '');
    
    // Pattern 3: Tool call references in the format tool_name({...})
    cleaned = cleaned.replace(/\b\w+_\w+\(\{[^}]*\}\)/g, '');
    
    // Pattern 4: Remove lines with "to=" patterns (internal routing artifacts)
    // Matches: "Այ to=lookup_project.commentary", "undefined to=route_note.commentary"
    // Do this BEFORE Unicode filtering to catch mixed corruption
    cleaned = cleaned.replace(/^.*\s+to=\w+\.\w+.*$/gm, '');
    
    // Pattern 5: Remove lines that look like spam/SEO (Chinese gambling sites, etc.)
    // Matches lines with Chinese characters followed by "app", "官网", etc.
    // This is more specific than general Unicode filtering
    const spamPattern = /^.*[\u4E00-\u9FFF].*(app|官网|彩票|中彩票).*$/gm;
    cleaned = cleaned.replace(spamPattern, '');
    
    // Pattern 6: Remove lines with suspicious Unicode at the START (corruption indicators)
    // Only remove lines that START with non-Latin scripts (not legitimate content)
    // This catches corruption like "Այ to=..." or "สามสิบเอ็ด" at line start
    const corruptionStartPattern = /^[\u0530-\u058F\u0E00-\u0E7F\u0A80-\u0AFF\u0C00-\u0C7F].*$/gm;
    cleaned = cleaned.replace(corruptionStartPattern, '');
    
    // Pattern 7: Lines that are purely reasoning/commentary before the actual content
    // Look for lines like "I'll verify...", "Checking...", etc.
    const lines = cleaned.split('\n');
    let startIndex = 0;
    
    // Skip leading lines that look like internal commentary
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (line === '') continue;
        
        // Check if line looks like commentary (starts with action verbs, contains "tool", etc.)
        const isCommentary = /^(checking|verifying|looking|searching|analyzing|processing|determining|using|calling|executing|I'm|I am|Let me)/i.test(line)
            || line.includes('tool')
            || line.includes('{"')
            || line.includes('reasoning')
            || line.includes('undefined');
        
        if (!isCommentary) {
            // This looks like actual content - start from here
            startIndex = i;
            break;
        }
    }
    
    // Rejoin from the first real content line
    if (startIndex > 0) {
        cleaned = lines.slice(startIndex).join('\n');
    }
    
    // Final cleanup: remove multiple consecutive blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
};

export const create = (
    reasoning: Reasoning.ReasoningInstance,
    ctx: ToolContext
): ExecutorInstance => {
    const logger = Logging.getLogger();
    const registry = Registry.create(ctx);
  
    const process = async (transcriptText: string) => {
        const state: TranscriptionState = {
            originalText: transcriptText,
            correctedText: transcriptText,
            unknownEntities: [],
            resolvedEntities: new Map(),
            referencedEntities: {
                people: new Set(),
                projects: new Set(),
                terms: new Set(),
                companies: new Set(),
            },
            confidence: 0,
        };
    
        // Make resolvedEntities available to tools so they can avoid re-asking
        ctx.resolvedEntities = state.resolvedEntities;
    
        const toolsUsed: string[] = [];
        const contextChanges: ContextChangeRecord[] = [];
        let iterations = 0;
        let totalTokens = 0;
        const maxIterations = 15;
    
        // Use ConversationBuilder for conversation management with token budget
        const conversation = ConversationBuilder.create({ model: 'gpt-4o' })
            .withTokenBudget({
                max: 100000,                    // 100k token context window
                reserveForResponse: 4000,       // Reserve 4k tokens for response
                strategy: 'summarize',          // Summarize old messages if budget exceeded
                onBudgetExceeded: 'compress',   // Automatically compress when exceeded
                preserveSystem: true,           // Always keep system messages
                preserveRecent: 5               // Keep last 5 messages
            });
    
        // Build the system prompt
        const systemPrompt = `You are an intelligent transcription assistant. Your job is to:
1. Analyze the transcript for names, projects, and companies
2. Use the available tools to verify spellings and gather context
3. Correct any misheard names or terms
4. Determine the appropriate destination for this note
5. Produce a clean, accurate Markdown transcript

CRITICAL RULES:
- This is NOT a summary. Preserve ALL content from the original transcript.
- Only fix obvious transcription errors like misheard names.
- When you have finished processing, output the COMPLETE corrected transcript as Markdown.
- Do NOT say you don't have the transcript - it's in the conversation history.

OUTPUT REQUIREMENTS - EXTREMELY IMPORTANT:
- Your final response MUST contain ONLY the corrected transcript text.
- DO NOT include any commentary like "Using tools to..." or "Let me verify...".
- DO NOT include any explanations about what you're doing or have done.
- DO NOT include any tool call information or JSON in your response.
- DO NOT include any reasoning or processing notes.
- Your output will be inserted directly into the user-facing document.
- If you need to use tools, use them silently - don't narrate what you're doing.

Available tools:
- lookup_person: Find information about people (use for any name that might be misspelled)
- lookup_project: Find project routing information  
- verify_spelling: Ask user about unknown terms (if interactive mode)
- route_note: Determine where to file this note
- store_context: Remember new information for future use`;

        // Add system message using ConversationBuilder
        conversation.addSystemMessage(systemPrompt);
        
        // Add the initial user message with transcript
        const initialPrompt = `Here is the raw transcript to process:

--- BEGIN TRANSCRIPT ---
${transcriptText}
--- END TRANSCRIPT ---

Please:
1. Identify any names, companies, or technical terms that might be misspelled
2. Use the lookup_person tool to verify spelling of any names you find
3. Use route_note to determine the destination
4. Then output the COMPLETE corrected transcript as clean Markdown

CRITICAL: Your response must contain ONLY the transcript text - no commentary, no explanations, no tool information.
Remember: preserve ALL content, only fix transcription errors.`;

        conversation.addUserMessage(initialPrompt);

        try {
            // Initial reasoning call
            logger.debug('Starting agentic transcription - analyzing for names and routing...');
            let response = await reasoning.complete({
                systemPrompt,
                prompt: initialPrompt,
                tools: registry.getToolDefinitions(),
                maxIterations,
            });
            
            // Track token usage
            if (response.usage) {
                totalTokens += response.usage.totalTokens;
            }
            
            // Add assistant response to conversation
            if (response.toolCalls && response.toolCalls.length > 0) {
                conversation.addAssistantWithToolCalls(
                    response.content,
                    toRiotToolCalls(response.toolCalls)
                );
            } else {
                conversation.addAssistantMessage(response.content);
            }
    
            // Iterative tool use loop
            while (response.toolCalls && response.toolCalls.length > 0 && iterations < maxIterations) {
                iterations++;
                logger.debug('Iteration %d: Processing %d tool calls...', iterations, response.toolCalls.length);
      
                // Collect tool results
                const toolResults: Array<{ id: string; name: string; result: string }> = [];
      
                // Execute each tool call
                for (const toolCall of response.toolCalls) {
                    logger.debug('Executing tool: %s', toolCall.name);
                    toolsUsed.push(toolCall.name);
        
                    try {
                        const result = await registry.executeTool(toolCall.name, toolCall.arguments);
                        
                        // Format result for the model
                        const resultStr = JSON.stringify(result.data || { success: result.success, message: result.error || 'OK' });
                        toolResults.push({ id: toolCall.id, name: toolCall.name, result: resultStr });
                        
                        logger.debug('Tool %s result: %s', toolCall.name, result.success ? 'success' : 'failed');
          
                        // Handle results that need user input
                        // Interactive functionality moved to protokoll-cli
                        /* 
                        // eslint-disable-next-line no-constant-condition
                        if (result.needsUserInput && false) {
                            logger.info('Interactive: %s requires clarification', toolCall.name);
                            
                            const termName = String(toolCall.arguments.name || toolCall.arguments.term || '');
                            
                            const clarification = await ctx.interactiveInstance.handleClarification({
                                type: result.data?.clarificationType || 'general',
                                term: result.data?.term || termName,
                                context: result.userPrompt || '',
                                suggestion: result.data?.suggestion,
                                options: result.data?.options,
                            });
                            
                            if (clarification.response) {
                                state.resolvedEntities.set(termName, clarification.response);
                                logger.info('Clarified: %s -> %s', termName, clarification.response);
                                
                                // Handle new project/term wizard response
                                if (result.data?.clarificationType === 'new_project' && clarification.additionalInfo) {
                                    const wizardResult = clarification.additionalInfo as {
                                        action: 'create' | 'link' | 'term' | 'skip' | 'ignore';
                                        projectName?: string;
                                        destination?: string;
                                        description?: string;
                                        linkedProjectIndex?: number;
                                        linkedTermName?: string;
                                        aliasName?: string;
                                        termDescription?: string;
                                        // For 'term' action
                                        termName?: string;
                                        termExpansion?: string;
                                        termProjects?: number[];
                                        // For nested project creation from term wizard
                                        createdProject?: {
                                            action: 'create' | 'link' | 'skip';
                                            projectName?: string;
                                            destination?: string;
                                            description?: string;
                                        };
                                        // For 'ignore' action
                                        ignoredTerm?: string;
                                    };
                                    
                                    const knownProjects = result.data?.knownProjects as Array<{
                                        id: string;
                                        name: string;
                                        description?: string;
                                        classification?: { explicit_phrases?: string[]; context_type?: string };
                                        routing?: { destination: string; structure?: string; filename_options?: string[] };
                                    }> | undefined;
                                    
                                    if (wizardResult.action === 'create') {
                                        // CREATE NEW PROJECT
                                        const projectName = wizardResult.projectName || termName;
                                        const projectId = projectName.toLowerCase().replace(/\s+/g, '-');
                                        const projectDestination = wizardResult.destination;
                                        
                                        const newProject = {
                                            id: projectId,
                                            name: projectName,
                                            type: 'project' as const,
                                            description: wizardResult.description || `Project for "${projectName}"`,
                                            classification: {
                                                context_type: 'work' as const,
                                                explicit_phrases: [termName.toLowerCase(), projectName.toLowerCase()].filter((v, i, a) => a.indexOf(v) === i),
                                            },
                                            routing: {
                                                // Only include destination if explicitly provided - otherwise uses global default
                                                ...(projectDestination && { destination: projectDestination }),
                                                structure: 'month' as const,
                                                filename_options: ['date', 'time', 'subject'] as Array<'date' | 'time' | 'subject'>,
                                            },
                                            active: true,
                                        };
                                        
                                        try {
                                            await ctx.contextInstance.saveEntity(newProject);
                                            await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                            logger.info('Created new project: %s%s', projectName, projectDestination ? ` -> ${projectDestination}` : ' (using default destination)');
                                            
                                            contextChanges.push({
                                                entityType: 'project',
                                                entityId: projectId,
                                                entityName: projectName,
                                                action: 'created',
                                                details: {
                                                    ...(projectDestination && { destination: projectDestination }),
                                                    description: wizardResult.description,
                                                    triggeredByTerm: termName,
                                                },
                                            });
                                            
                                            // Update routing if destination was specified
                                            if (projectDestination) {
                                                state.routeDecision = {
                                                    projectId,
                                                    destination: { path: projectDestination, structure: 'month' },
                                                    confidence: 1.0,
                                                    signals: [{ type: 'explicit_phrase', value: termName, weight: 1.0 }],
                                                    reasoning: `User created new project "${projectName}" routing to ${projectDestination}`,
                                                };
                                            }
                                        } catch (error) {
                                            logger.warn('Failed to save new project: %s', error);
                                        }
                                        
                                    } else if (wizardResult.action === 'link' && wizardResult.linkedTermName) {
                                        // LINK AS ALIAS TO EXISTING TERM
                                        const existingTermName = wizardResult.linkedTermName;
                                        const aliasVariant = wizardResult.aliasName || termName;
                                        
                                        // Search for the existing term
                                        const termSearch = await ctx.contextInstance.search(existingTermName);
                                        const existingTerm = termSearch.find(e => e.type === 'term' && 
                                            e.name.toLowerCase() === existingTermName.toLowerCase());
                                        
                                        if (existingTerm) {
                                            // Add the new variant to sounds_like
                                            const existingVariants = (existingTerm as { sounds_like?: string[] }).sounds_like || [];
                                            const updatedVariants = [...existingVariants, aliasVariant.toLowerCase()]
                                                .filter((v, i, a) => a.indexOf(v) === i); // dedupe
                                            
                                            const updatedTerm = {
                                                ...existingTerm,
                                                type: 'term' as const,
                                                sounds_like: updatedVariants,
                                            };
                                            
                                            try {
                                                await ctx.contextInstance.saveEntity(updatedTerm);
                                                await ctx.contextInstance.reload();
                                                logger.info('Added alias "%s" to existing term "%s"', aliasVariant, existingTerm.name);
                                                
                                                // Mark as resolved
                                                state.resolvedEntities.set(termName, existingTerm.name);
                                                state.resolvedEntities.set(aliasVariant, existingTerm.name);
                                                
                                                contextChanges.push({
                                                    entityType: 'term',
                                                    entityId: existingTerm.id,
                                                    entityName: existingTerm.name,
                                                    action: 'updated',
                                                    details: {
                                                        addedAlias: aliasVariant,
                                                        sounds_like: updatedVariants,
                                                    },
                                                });
                                                
                                                // If term has associated projects, use for routing
                                                const termProjects = (existingTerm as { projects?: string[] }).projects || [];
                                                if (termProjects.length > 0) {
                                                    const allProjects = ctx.contextInstance.getAllProjects();
                                                    const primaryProject = allProjects.find(p => p.id === termProjects[0]);
                                                    if (primaryProject?.routing?.destination) {
                                                        state.routeDecision = {
                                                            projectId: primaryProject.id,
                                                            destination: {
                                                                path: primaryProject.routing.destination,
                                                                structure: 'month'
                                                            },
                                                            confidence: 1.0,
                                                            signals: [{ type: 'explicit_phrase', value: existingTerm.name, weight: 1.0 }],
                                                            reasoning: `User linked "${aliasVariant}" as alias for term "${existingTerm.name}" associated with project "${primaryProject.name}"`,
                                                        };
                                                    }
                                                }
                                            } catch (error) {
                                                logger.warn('Failed to add alias to existing term: %s', error);
                                            }
                                        } else {
                                            logger.warn('Could not find existing term "%s" to link alias', existingTermName);
                                        }
                                        
                                    } else if (wizardResult.action === 'link' && typeof wizardResult.linkedProjectIndex === 'number') {
                                        // LINK TO EXISTING PROJECT
                                        if (knownProjects && wizardResult.linkedProjectIndex < knownProjects.length) {
                                            const linkedProject = knownProjects[wizardResult.linkedProjectIndex];
                                            
                                            // Add the term as an alias
                                            const existingPhrases = linkedProject.classification?.explicit_phrases || [];
                                            const updatedPhrases = [...existingPhrases, termName.toLowerCase()]
                                                .filter((v, i, a) => a.indexOf(v) === i); // dedupe
                                            
                                            const updatedProject = {
                                                ...linkedProject,
                                                type: 'project' as const,
                                                // Add term description to project notes if provided
                                                notes: wizardResult.termDescription 
                                                    ? `${linkedProject.description || ''}\n\n${termName}: ${wizardResult.termDescription}`.trim()
                                                    : linkedProject.description,
                                                classification: {
                                                    ...linkedProject.classification,
                                                    context_type: (linkedProject.classification?.context_type || 'work') as 'work' | 'personal' | 'mixed',
                                                    explicit_phrases: updatedPhrases,
                                                },
                                                routing: {
                                                    // Preserve existing destination (or omit if not set)
                                                    ...(linkedProject.routing?.destination && { destination: linkedProject.routing.destination }),
                                                    structure: (linkedProject.routing?.structure || 'month') as 'none' | 'year' | 'month' | 'day',
                                                    filename_options: (linkedProject.routing?.filename_options || ['date', 'time']) as Array<'date' | 'time' | 'subject'>,
                                                },
                                            };
                                            
                                            try {
                                                await ctx.contextInstance.saveEntity(updatedProject);
                                                await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                                logger.info('Linked "%s" to project "%s"', termName, linkedProject.name);
                                                
                                                contextChanges.push({
                                                    entityType: 'project',
                                                    entityId: linkedProject.id,
                                                    entityName: linkedProject.name,
                                                    action: 'updated',
                                                    details: {
                                                        addedAlias: termName,
                                                        termDescription: wizardResult.termDescription,
                                                        explicit_phrases: updatedPhrases,
                                                    },
                                                });
                                                
                                                // Update routing to use the linked project
                                                if (linkedProject.routing?.destination) {
                                                    state.routeDecision = {
                                                        projectId: linkedProject.id,
                                                        destination: { 
                                                            path: linkedProject.routing.destination, 
                                                            structure: 'month' 
                                                        },
                                                        confidence: 1.0,
                                                        signals: [{ type: 'explicit_phrase', value: termName, weight: 1.0 }],
                                                        reasoning: `User linked "${termName}" to existing project "${linkedProject.name}"`,
                                                    };
                                                }
                                            } catch (error) {
                                                logger.warn('Failed to update project with alias: %s', error);
                                            }
                                        }
                                    } else if (wizardResult.action === 'term') {
                                        // CREATE NEW TERM ENTITY
                                        const termNameFinal = wizardResult.termName || termName;
                                        const termId = termNameFinal.toLowerCase().replace(/\s+/g, '-');
                                        
                                        // Get project IDs from indices
                                        const projectIds: string[] = [];
                                        if (wizardResult.termProjects && knownProjects) {
                                            for (const idx of wizardResult.termProjects) {
                                                if (idx >= 0 && idx < knownProjects.length) {
                                                    projectIds.push(knownProjects[idx].id);
                                                }
                                            }
                                        }
                                        
                                        // Handle nested project creation from term wizard
                                        if (wizardResult.createdProject?.action === 'create' && wizardResult.createdProject.projectName) {
                                            const projectName = wizardResult.createdProject.projectName;
                                            const projectId = projectName.toLowerCase().replace(/\s+/g, '-');
                                            const projectDestination = wizardResult.createdProject.destination;
                                            
                                            const newProject = {
                                                id: projectId,
                                                name: projectName,
                                                type: 'project' as const,
                                                description: wizardResult.createdProject.description || `Project for "${projectName}"`,
                                                classification: {
                                                    context_type: 'work' as const,
                                                    explicit_phrases: [projectName.toLowerCase(), termNameFinal.toLowerCase()].filter((v, i, a) => a.indexOf(v) === i),
                                                },
                                                routing: {
                                                    // Only include destination if explicitly provided - otherwise uses global default
                                                    ...(projectDestination && { destination: projectDestination }),
                                                    structure: 'month' as const,
                                                    filename_options: ['date', 'time', 'subject'] as Array<'date' | 'time' | 'subject'>,
                                                },
                                                active: true,
                                            };
                                            
                                            try {
                                                await ctx.contextInstance.saveEntity(newProject);
                                                await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                                logger.info('Created new project from term wizard: %s%s', projectName, projectDestination ? ` -> ${projectDestination}` : ' (using default destination)');
                                                
                                                // Add the new project to the projectIds list for term association
                                                projectIds.push(projectId);
                                                
                                                contextChanges.push({
                                                    entityType: 'project',
                                                    entityId: projectId,
                                                    entityName: projectName,
                                                    action: 'created',
                                                    details: {
                                                        ...(projectDestination && { destination: projectDestination }),
                                                        description: wizardResult.createdProject.description,
                                                        createdForTerm: termNameFinal,
                                                    },
                                                });
                                                
                                                // Update routing to use the new project (if destination was specified)
                                                if (projectDestination) {
                                                    state.routeDecision = {
                                                        projectId,
                                                        destination: { path: projectDestination, structure: 'month' },
                                                        confidence: 1.0,
                                                        signals: [{ type: 'explicit_phrase', value: termNameFinal, weight: 1.0 }],
                                                        reasoning: `User created project "${projectName}" for term "${termNameFinal}"`,
                                                    };
                                                }
                                            } catch (error) {
                                                logger.warn('Failed to save new project from term wizard: %s', error);
                                            }
                                        }
                                        
                                        const newTerm = {
                                            id: termId,
                                            name: termNameFinal,
                                            type: 'term' as const,
                                            expansion: wizardResult.termExpansion,
                                            notes: wizardResult.termDescription,
                                            projects: projectIds.length > 0 ? projectIds : undefined,
                                            sounds_like: [termName.toLowerCase()],
                                        };
                                        
                                        try {
                                            await ctx.contextInstance.saveEntity(newTerm);
                                            await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                            logger.info('Created new term: %s (projects: %s)', 
                                                termNameFinal, 
                                                projectIds.length > 0 ? projectIds.join(', ') : 'none'
                                            );
                                            
                                            contextChanges.push({
                                                entityType: 'term',
                                                entityId: termId,
                                                entityName: termNameFinal,
                                                action: 'created',
                                                details: {
                                                    expansion: wizardResult.termExpansion,
                                                    projects: projectIds,
                                                    description: wizardResult.termDescription,
                                                },
                                            });
                                            
                                            // If term has associated projects and we haven't set routing yet, use the first one
                                            if (projectIds.length > 0 && !state.routeDecision) {
                                                // For newly created project, we already set routing above
                                                // For existing projects, look them up
                                                if (knownProjects) {
                                                    const primaryProject = knownProjects.find(p => p.id === projectIds[0]);
                                                    if (primaryProject?.routing?.destination) {
                                                        state.routeDecision = {
                                                            projectId: primaryProject.id,
                                                            destination: { 
                                                                path: primaryProject.routing.destination, 
                                                                structure: 'month' 
                                                            },
                                                            confidence: 1.0,
                                                            signals: [{ type: 'explicit_phrase', value: termNameFinal, weight: 1.0 }],
                                                            reasoning: `User created term "${termNameFinal}" associated with project "${primaryProject.name}"`,
                                                        };
                                                    }
                                                }
                                            }
                                        } catch (error) {
                                            logger.warn('Failed to save new term: %s', error);
                                        }
                                    } else if (wizardResult.action === 'ignore' && wizardResult.ignoredTerm) {
                                        // IGNORE - add term to ignore list so user won't be asked again
                                        const ignoredTermName = wizardResult.ignoredTerm;
                                        const ignoredId = ignoredTermName.toLowerCase()
                                            .replace(/[^a-z0-9]/g, '-')
                                            .replace(/-+/g, '-')
                                            .replace(/^-|-$/g, '');
                                        
                                        const newIgnored = {
                                            id: ignoredId,
                                            name: ignoredTermName,
                                            type: 'ignored' as const,
                                            ignoredAt: new Date().toISOString(),
                                        };
                                        
                                        try {
                                            await ctx.contextInstance.saveEntity(newIgnored);
                                            await ctx.contextInstance.reload();
                                            logger.info('Added to ignore list: %s', ignoredTermName);
                                            
                                            contextChanges.push({
                                                entityType: 'ignored',
                                                entityId: ignoredId,
                                                entityName: ignoredTermName,
                                                action: 'created',
                                                details: {
                                                    reason: 'User chose to ignore this term',
                                                },
                                            });
                                        } catch (error) {
                                            logger.warn('Failed to save ignored term: %s', error);
                                        }
                                    }
                                    // 'skip' action - do nothing
                                }
                                
                                // Handle new person wizard response
                                if (result.data?.clarificationType === 'new_person' && clarification.additionalInfo) {
                                    const personWizardResult = clarification.additionalInfo as {
                                        action: 'create' | 'skip';
                                        personName?: string;
                                        organization?: string;
                                        notes?: string;
                                        linkedProjectId?: string;
                                        linkedProjectIndex?: number;
                                        createdProject?: {
                                            action: 'create' | 'link' | 'skip';
                                            projectName?: string;
                                            destination?: string;
                                            description?: string;
                                        };
                                    };
                                    
                                    const knownProjects = result.data?.knownProjects as Array<{
                                        id: string;
                                        name: string;
                                        description?: string;
                                        classification?: { explicit_phrases?: string[]; context_type?: string };
                                        routing?: { destination: string; structure?: string; filename_options?: string[] };
                                    }> | undefined;
                                    
                                    if (personWizardResult.action === 'create') {
                                        let linkedProjectId: string | undefined;
                                        
                                        // First, handle any nested project creation
                                        if (personWizardResult.createdProject?.action === 'create' && personWizardResult.createdProject.projectName) {
                                            const projectName = personWizardResult.createdProject.projectName;
                                            const projectId = projectName.toLowerCase().replace(/\s+/g, '-');
                                            const projectDestination = personWizardResult.createdProject.destination;
                                            
                                            const newProject = {
                                                id: projectId,
                                                name: projectName,
                                                type: 'project' as const,
                                                description: personWizardResult.createdProject.description || `Project for "${projectName}"`,
                                                classification: {
                                                    context_type: 'work' as const,
                                                    explicit_phrases: [projectName.toLowerCase()],
                                                },
                                                routing: {
                                                    // Only include destination if explicitly provided - otherwise uses global default
                                                    ...(projectDestination && { destination: projectDestination }),
                                                    structure: 'month' as const,
                                                    filename_options: ['date', 'time', 'subject'] as Array<'date' | 'time' | 'subject'>,
                                                },
                                                active: true,
                                            };
                                            
                                            try {
                                                await ctx.contextInstance.saveEntity(newProject);
                                                await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                                logger.info('Created new project from person wizard: %s%s', projectName, projectDestination ? ` -> ${projectDestination}` : ' (using default destination)');
                                                linkedProjectId = projectId;
                                                
                                                contextChanges.push({
                                                    entityType: 'project',
                                                    entityId: projectId,
                                                    entityName: projectName,
                                                    action: 'created',
                                                    details: {
                                                        ...(projectDestination && { destination: projectDestination }),
                                                        description: personWizardResult.createdProject.description,
                                                        createdForPerson: personWizardResult.personName,
                                                    },
                                                });
                                                
                                                // Update routing to use the new project (if destination was specified)
                                                if (projectDestination) {
                                                    state.routeDecision = {
                                                        projectId,
                                                        destination: { path: projectDestination, structure: 'month' },
                                                        confidence: 1.0,
                                                        signals: [{ type: 'explicit_phrase', value: projectName, weight: 1.0 }],
                                                        reasoning: `User created project "${projectName}" for person "${personWizardResult.personName}"`,
                                                    };
                                                }
                                            } catch (error) {
                                                logger.warn('Failed to save new project from person wizard: %s', error);
                                            }
                                        } else if (typeof personWizardResult.linkedProjectIndex === 'number' && knownProjects) {
                                            // User linked to existing project
                                            if (personWizardResult.linkedProjectIndex < knownProjects.length) {
                                                const linkedProject = knownProjects[personWizardResult.linkedProjectIndex];
                                                linkedProjectId = linkedProject.id;
                                                
                                                // Update routing to use the linked project
                                                if (linkedProject.routing?.destination) {
                                                    state.routeDecision = {
                                                        projectId: linkedProject.id,
                                                        destination: { 
                                                            path: linkedProject.routing.destination, 
                                                            structure: 'month' 
                                                        },
                                                        confidence: 1.0,
                                                        signals: [{ type: 'explicit_phrase', value: personWizardResult.personName || termName, weight: 1.0 }],
                                                        reasoning: `User linked person "${personWizardResult.personName}" to project "${linkedProject.name}"`,
                                                    };
                                                }
                                            }
                                        }
                                        
                                        // Now save the person
                                        const personName = personWizardResult.personName || termName;
                                        const personId = personName.toLowerCase().replace(/\s+/g, '-');
                                        
                                        const newPerson = {
                                            id: personId,
                                            name: personName,
                                            type: 'person' as const,
                                            organization: personWizardResult.organization,
                                            notes: personWizardResult.notes,
                                            projects: linkedProjectId ? [linkedProjectId] : [],
                                            sounds_like: [termName.toLowerCase()],
                                        };
                                        
                                        try {
                                            await ctx.contextInstance.saveEntity(newPerson);
                                            await ctx.contextInstance.reload();  // Reload so subsequent searches find this entity
                                            logger.info('Created new person: %s (org: %s, project: %s)', 
                                                personName, 
                                                personWizardResult.organization || 'none',
                                                linkedProjectId || 'none'
                                            );
                                            
                                            // Update resolved entities with correct name
                                            state.resolvedEntities.set(termName, personName);
                                            
                                            contextChanges.push({
                                                entityType: 'person',
                                                entityId: personId,
                                                entityName: personName,
                                                action: 'created',
                                                details: {
                                                    organization: personWizardResult.organization,
                                                    linkedProject: linkedProjectId,
                                                    notes: personWizardResult.notes,
                                                    heardAs: termName,
                                                },
                                            });
                                        } catch (error) {
                                            logger.warn('Failed to save new person: %s', error);
                                        }
                                    }
                                    // 'skip' action - do nothing
                                }
                            }
                        }
                        */ // End of commented interactive code
          
                        // Update state based on tool results
                        if (result.data?.person) {
                            state.resolvedEntities.set(result.data.person.name, result.data.suggestion);
                            // Track person entity reference
                            state.referencedEntities.people.add(result.data.person.id);
                        }
                        
                        // Track term entities
                        if (result.data?.term) {
                            state.referencedEntities.terms.add(result.data.term.id);
                        }
                        
                        // Track company entities
                        if (result.data?.company) {
                            state.referencedEntities.companies.add(result.data.company.id);
                        }
                        
                        // Capture routing from route_note tool
                        if (result.data?.routingDecision?.destination) {
                            const routingDecision = result.data.routingDecision;
                            state.routeDecision = {
                                projectId: routingDecision.projectId,
                                destination: routingDecision.destination,
                                confidence: routingDecision.confidence || 1.0,
                                signals: routingDecision.signals,
                                reasoning: routingDecision.reasoning || 'Determined by route_note tool',
                            };
                            
                            // Track project if routing decision includes it
                            if (routingDecision.projectId) {
                                state.referencedEntities.projects.add(routingDecision.projectId);
                            }
                        }
                        
                        // Capture routing from lookup_project when project has routing config
                        if (result.data?.found && result.data?.project?.routing?.destination) {
                            const project = result.data.project;
                            state.routeDecision = {
                                projectId: project.id,
                                destination: { 
                                    path: project.routing.destination,
                                    structure: project.routing.structure || 'month',
                                },
                                confidence: 1.0,
                                signals: [{ type: 'explicit_phrase', value: project.name, weight: 1.0 }],
                                reasoning: `Matched project "${project.name}" with routing to ${project.routing.destination}`,
                            };
                            logger.debug('Captured routing from project lookup: %s -> %s', 
                                project.name, project.routing.destination);
                            
                            // Track project entity reference
                            state.referencedEntities.projects.add(project.id);
                        }
          
                    } catch (error) {
                        logger.error('Tool execution failed', { tool: toolCall.name, error });
                        toolResults.push({ 
                            id: toolCall.id, 
                            name: toolCall.name, 
                            result: JSON.stringify({ error: String(error) }) 
                        });
                    }
                }
                
                // Add tool results to conversation
                for (const tr of toolResults) {
                    conversation.addToolResult(tr.id, tr.result, tr.name);
                }
      
                // Build continuation prompt with full context
                const continuationPrompt = `Tool results received. Here's a reminder of your task:

ORIGINAL TRANSCRIPT (process this):
--- BEGIN TRANSCRIPT ---
${transcriptText}
--- END TRANSCRIPT ---

Corrections made so far: ${state.resolvedEntities.size > 0 ? Array.from(state.resolvedEntities.entries()).map(([k, v]) => `${k} -> ${v}`).join(', ') : 'none yet'}

Continue analyzing. If you need more information, use the tools. 
When you're done with tool calls, output the COMPLETE corrected transcript as Markdown.
Do NOT summarize - include ALL original content with corrections applied.

CRITICAL REMINDER: Your response must contain ONLY the transcript text. Do NOT include any commentary, explanations, or processing notes - those will leak into the user-facing document.`;

                conversation.addUserMessage(continuationPrompt);
      
                // Continue conversation with full context
                response = await reasoning.complete({
                    systemPrompt,
                    prompt: continuationPrompt,
                    tools: registry.getToolDefinitions(),
                });
                
                // Track token usage
                if (response.usage) {
                    totalTokens += response.usage.totalTokens;
                }
                
                // Add assistant response to conversation
                if (response.toolCalls && response.toolCalls.length > 0) {
                    conversation.addAssistantWithToolCalls(
                        response.content,
                        toRiotToolCalls(response.toolCalls)
                    );
                } else {
                    conversation.addAssistantMessage(response.content);
                }
            }
    
            // Extract final corrected text
            if (response.content && response.content.length > 50) {
                // Clean the response to remove any leaked internal processing
                const cleanedContent = cleanResponseContent(response.content);
                
                if (cleanedContent !== response.content) {
                    const removedChars = response.content.length - cleanedContent.length;
                    logger.warn('Removed leaked internal processing from response (%d -> %d chars, removed %d chars)',
                        response.content.length, cleanedContent.length, removedChars);
                    
                    // Detect severe corruption (>10% of content removed or suspicious patterns)
                    const corruptionRatio = removedChars / response.content.length;
                    const hasSuspiciousUnicode = /[\u0530-\u058F\u0E00-\u0E7F\u4E00-\u9FFF\u0A80-\u0AFF\u0C00-\u0C7F]/.test(response.content);
                    
                    if (corruptionRatio > 0.1 || hasSuspiciousUnicode) {
                        logger.error('SEVERE CORRUPTION DETECTED in LLM response (%.1f%% removed, suspicious unicode: %s)',
                            corruptionRatio * 100, hasSuspiciousUnicode);
                        logger.error('Raw response preview (first 500 chars): %s', 
                            response.content.substring(0, 500).replace(/\n/g, '\\n'));
                    }
                }
                
                state.correctedText = cleanedContent;
                state.confidence = 0.9;
                logger.debug('Final transcript generated: %d characters', cleanedContent.length);
            } else {
                // Model didn't produce content - ask for it explicitly
                logger.debug('Model did not produce transcript, requesting explicitly...');
                
                const finalRequest = `Please output the COMPLETE corrected transcript now.

ORIGINAL:
${transcriptText}

CORRECTIONS TO APPLY:
${state.resolvedEntities.size > 0 ? Array.from(state.resolvedEntities.entries()).map(([k, v]) => `- "${k}" should be "${v}"`).join('\n') : 'None identified'}

Output the full transcript as clean Markdown. Do NOT summarize.

CRITICAL: Your response must contain ONLY the corrected transcript text - absolutely no commentary, tool information, or explanations.`;

                const finalResponse = await reasoning.complete({
                    systemPrompt,
                    prompt: finalRequest,
                });
                
                // Track token usage
                if (finalResponse.usage) {
                    totalTokens += finalResponse.usage.totalTokens;
                }
                
                // Clean the final response as well
                const cleanedFinalContent = cleanResponseContent(finalResponse.content || transcriptText);
                
                if (cleanedFinalContent !== finalResponse.content) {
                    const removedChars = (finalResponse.content?.length || 0) - cleanedFinalContent.length;
                    logger.warn('Removed leaked internal processing from final response (%d -> %d chars, removed %d chars)',
                        finalResponse.content?.length || 0, cleanedFinalContent.length, removedChars);
                    
                    // Detect severe corruption
                    const corruptionRatio = removedChars / (finalResponse.content?.length || 1);
                    const hasSuspiciousUnicode = /[\u0530-\u058F\u0E00-\u0E7F\u4E00-\u9FFF\u0A80-\u0AFF\u0C00-\u0C7F]/.test(finalResponse.content || '');
                    
                    if (corruptionRatio > 0.1 || hasSuspiciousUnicode) {
                        logger.error('SEVERE CORRUPTION DETECTED in final LLM response (%.1f%% removed, suspicious unicode: %s)',
                            corruptionRatio * 100, hasSuspiciousUnicode);
                        logger.error('Raw response preview (first 500 chars): %s', 
                            (finalResponse.content || '').substring(0, 500).replace(/\n/g, '\\n'));
                    }
                }
                
                state.correctedText = cleanedFinalContent;
                state.confidence = 0.8;
            }
    
        } catch (error) {
            logger.error('Agentic processing failed', { error });
            // Fall back to original text
            state.correctedText = transcriptText;
            state.confidence = 0.5;
        }
    
        return {
            enhancedText: state.correctedText,
            state,
            toolsUsed: [...new Set(toolsUsed)],
            iterations,
            totalTokens: totalTokens > 0 ? totalTokens : undefined,
            contextChanges: contextChanges.length > 0 ? contextChanges : undefined,
        };
    };
  
    return { process };
};

