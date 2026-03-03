/**
 * Agentic Executor
 * 
 * Executes the agentic transcription loop with tool calls.
 * Uses RiotPrompt's ConversationBuilder for conversation management.
 */

import {
    ModelCallCompleteLogEntry,
    ModelCallStartLogEntry,
    ToolCallLogEntry,
    ToolContext,
    TranscriptionState,
} from './types';
import * as Registry from './registry';
import * as Reasoning from '../reasoning';
import * as Logging from '../logging';
import { ConversationBuilder, ToolCall as RiotToolCall } from '@kjerneverk/riotprompt';
import { EntityPrepositioner } from '../weighting/prepositioning';

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
    let cleaned = content;

    // Strip markdown code fences - LLMs often wrap output in ```markdown ... ```
    // This avoids "markdown" appearing as the first line of the transcript
    cleaned = cleaned.replace(/^```\s*(?:markdown|md|txt)?\s*\r?\n?/i, '');
    cleaned = cleaned.replace(/\r?\n?```\s*$/m, '');
    // Remove orphaned "markdown" line (can occur when AI uses ``` on separate line from language tag)
    cleaned = cleaned.replace(/^\s*markdown\s*\r?\n/i, '');

    // Remove common patterns of leaked internal processing
    // Pattern 1: "Using tools to..." type commentary
    cleaned = cleaned.replace(/^(?:Using tools?|Let me|I'll|I will|Now I'll|First,?\s*I(?:'ll| will)).*?[\r\n]+/gim, '');
    
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

    const logCleaningWarnings = (original: string, cleaned: string, label: string): void => {
        if (cleaned === original) return;
        const removedChars = original.length - cleaned.length;
        logger.warn('Removed leaked internal processing from %s (%d -> %d chars, removed %d chars)',
            label, original.length, cleaned.length, removedChars);
        const corruptionRatio = removedChars / original.length;
        const hasSuspiciousUnicode = /[\u0530-\u058F\u0E00-\u0E7F\u4E00-\u9FFF\u0A80-\u0AFF\u0C00-\u0C7F]/.test(original);
        if (corruptionRatio > 0.1 || hasSuspiciousUnicode) {
            logger.error('SEVERE CORRUPTION DETECTED in LLM %s (%.1f%% removed, suspicious unicode: %s)',
                label, corruptionRatio * 100, hasSuspiciousUnicode);
            logger.error('Raw preview (first 500 chars): %s',
                original.substring(0, 500).replace(/\n/g, '\\n'));
        }
    };
  
    const process = async (transcriptText: string) => {
        // Seed referencedEntities from pre-identified entities (from simple-replace phase)
        // so they appear in the transcript metadata even if the LLM doesn't re-look them up.
        const pre = ctx.preIdentifiedEntities;
        const state: TranscriptionState = {
            originalText: transcriptText,
            correctedText: transcriptText,
            unknownEntities: [],
            resolvedEntities: new Map(),
            referencedEntities: {
                people: pre?.people ? new Set(pre.people) : new Set(),
                projects: pre?.projects ? new Set(pre.projects) : new Set(),
                terms: pre?.terms ? new Set(pre.terms) : new Set(),
                companies: pre?.companies ? new Set(pre.companies) : new Set(),
            },
            confidence: 0,
        };
    
        // Make resolvedEntities available to tools so they can avoid re-asking
        ctx.resolvedEntities = state.resolvedEntities;
    
        const toolsUsed: string[] = [];
        const contextChanges: ContextChangeRecord[] = [];
        let iterations = 0;
        let totalTokens = 0;
        const maxIterations = 20;
        let modelCallIndex = 0;
    
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
    
        // Generate entity prepositioning guidance if weight model is available
        // Note: At this point, routing hasn't happened yet, so we can't use project-specific predictions
        // The weight model will still provide co-occurrence predictions based on any entities found
        const prepositioner = ctx.weightModelProvider
            ? new EntityPrepositioner(ctx.weightModelProvider, ctx.contextInstance)
            : null;
        
        const entityGuidance = prepositioner
            ? prepositioner.generateGuidance(undefined) // No project ID yet
            : { likelyEntities: [], guidance: '' };

        // Build the system prompt
        let systemPrompt = `You are a light-touch transcription enhancer. You clean up raw voice transcripts with minimal changes — the output should read very close to the input, just better formatted.

## Your job:
1. Use the available tools to verify entity names and determine routing
2. Lightly format the transcript for readability
3. Preserve the speaker's words as closely as possible

## What to do:
- **Paragraphs**: Break the wall of text into paragraphs where the speaker shifts to a new idea or topic
- **Headings**: Add a brief ## heading when there is a clear topic change
- **Entity corrections**: Fix misspelled names/terms using tool lookups
- **Light cleanup**: Remove obvious filler (um, uh) and false starts, but keep the speaker's natural phrasing otherwise
- **Formatting**: Use bullet points only where the speaker is clearly listing items

## What NOT to do:
- Do NOT rewrite sentences or change the speaker's wording beyond filler removal
- Do NOT add content, interpretation, or editorial commentary
- Do NOT summarize or condense — the output should be approximately the same length
- Do NOT over-structure — only add headings where topics genuinely change
- Do NOT remove conversational asides or tangents — they are part of the content

## OUTPUT REQUIREMENTS:
- Your final response MUST contain ONLY the enhanced transcript as Markdown
- DO NOT wrap in code blocks (no \`\`\`markdown)
- DO NOT include commentary, explanations, or processing notes
- DO NOT narrate tool usage — use tools silently
- Your output goes directly into the user-facing document

## Available tools:
- lookup_person: Verify spelling of people's names
- lookup_project: Find project routing information
- verify_spelling: Ask about unknown terms (if interactive mode)
- route_note: Determine where to file this note
- store_context: Remember new information for future use

## Tool call discipline — IMPORTANT:
- You have a budget of approximately 5–8 tool calls for the ENTIRE session
- Call lookup_person only for names that are clearly misspelled or genuinely ambiguous
- Call route_note exactly ONCE to determine filing destination
- Do NOT call the same tool with the same arguments more than once
- Once you have the key entity corrections and routing, produce the output immediately — do not keep calling tools`;

        // Add entity guidance if available
        if (entityGuidance.guidance) {
            systemPrompt += `\n\n## Entity Guidance\n${entityGuidance.guidance}`;
            systemPrompt += '\n\nUse this guidance to improve entity recognition, but verify entities exist in the context before referencing them.';
        }

        // Inform the LLM about entities already matched by the simple-replace phase
        if (ctx.preIdentifiedEntities) {
            const lines: string[] = [];
            const { preIdentifiedEntities: pre } = ctx;

            for (const termId of pre.terms) {
                const term = ctx.contextInstance.getTerm(termId);
                if (term) lines.push(`- Term: **${term.name}** (id: ${term.id})`);
            }
            for (const projectId of pre.projects) {
                const project = ctx.contextInstance.getProject(projectId);
                if (project) lines.push(`- Project: **${project.name}** (id: ${project.id})`);
            }
            for (const personId of pre.people) {
                const person = ctx.contextInstance.getPerson(personId);
                if (person) lines.push(`- Person: **${person.name}** (id: ${person.id})`);
            }
            for (const companyId of pre.companies) {
                const company = ctx.contextInstance.getCompany(companyId);
                if (company) lines.push(`- Company: **${company.name}** (id: ${company.id})`);
            }

            if (lines.length > 0) {
                systemPrompt += `\n\n## Pre-matched Entities\nThe following entities were identified via sounds_like matching before you received the transcript. Their names have already been corrected in the text — do NOT call lookup tools for these:\n${lines.join('\n')}`;
            }
        }

        // Add system message using ConversationBuilder
        conversation.addSystemMessage(systemPrompt);
        
        // Add the initial user message with transcript
        const initialPrompt = `Here is a raw voice transcript to clean up:

--- BEGIN TRANSCRIPT ---
${transcriptText}
--- END TRANSCRIPT ---

Steps:
1. Use lookup_person for any names that might be misspelled
2. Use route_note to determine where to file this note
3. Then output the transcript with light formatting: paragraphs at topic shifts, a heading where topics clearly change, filler words removed. Keep the speaker's own words.`;

        conversation.addUserMessage(initialPrompt);

        const callModel = async (
            phase: 'initial' | 'continuation' | 'final',
            request: {
                systemPrompt: string;
                prompt: string;
                tools?: ReturnType<typeof registry.getToolDefinitions>;
                maxIterations?: number;
            },
        ) => {
            modelCallIndex++;
            const startEntry: ModelCallStartLogEntry = {
                callIndex: modelCallIndex,
                phase,
                request: {
                    model: ctx.modelConfiguration?.model,
                    reasoningLevel: ctx.modelConfiguration?.reasoningLevel,
                    prompt: request.prompt,
                    systemPrompt: request.systemPrompt,
                    maxIterations: request.maxIterations,
                    tools: request.tools,
                },
                timestamp: new Date(),
            };
            ctx.onModelCallStart?.(startEntry);

            const started = Date.now();
            const response = await reasoning.complete({
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                tools: request.tools,
                maxIterations: request.maxIterations,
            });
            const completeEntry: ModelCallCompleteLogEntry = {
                callIndex: modelCallIndex,
                phase,
                durationMs: Date.now() - started,
                response: {
                    model: response.model,
                    finishReason: response.finishReason,
                    usage: response.usage,
                    toolCalls: response.toolCalls,
                    contentLength: response.content?.length ?? 0,
                },
                timestamp: new Date(),
            };
            ctx.onModelCallComplete?.(completeEntry);
            return response;
        };

        try {
            // Initial reasoning call
            logger.debug('Starting agentic transcription - analyzing for names and routing...');
            let response = await callModel('initial', {
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

                    // Notify caller that a tool is starting
                    ctx.onToolCallStart?.(toolCall.name, toolCall.arguments);
        
                    const callStart = Date.now();
                    try {
                        const result = await registry.executeTool(toolCall.name, toolCall.arguments);
                        
                        // Format result for the model
                        const resultStr = JSON.stringify(result.data || { success: result.success, message: result.error || 'OK' });
                        toolResults.push({ id: toolCall.id, name: toolCall.name, result: resultStr });
                        
                        logger.debug('Tool %s result: %s', toolCall.name, result.success ? 'success' : 'failed');

                        // Notify caller that the tool completed
                        const callEntry: ToolCallLogEntry = {
                            tool: toolCall.name,
                            input: toolCall.arguments,
                            output: result.data ?? { success: result.success, message: result.error || 'OK' },
                            durationMs: Date.now() - callStart,
                            success: result.success,
                            timestamp: new Date(),
                        };
                        ctx.onToolCallComplete?.(callEntry);
          
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
                        ctx.onToolCallComplete?.({
                            tool: toolCall.name,
                            input: toolCall.arguments,
                            output: { error: String(error) },
                            durationMs: Date.now() - callStart,
                            success: false,
                            timestamp: new Date(),
                        });
                    }
                }
                
                // Add tool results to conversation
                for (const tr of toolResults) {
                    conversation.addToolResult(tr.id, tr.result, tr.name);
                }
      
                // Build continuation prompt with full context
                const correctionsNote = state.resolvedEntities.size > 0
                    ? `\nConfirmed corrections: ${Array.from(state.resolvedEntities.entries()).map(([k, v]) => `"${k}" → "${v}"`).join(', ')}`
                    : '';

                const toolHistory = toolsUsed.length > 0
                    ? `\nTools called so far (do NOT repeat these): ${toolsUsed.join(', ')}`
                    : '';

                const urgencyNote = toolsUsed.length >= 8
                    ? `\n\n🛑 STOP CALLING TOOLS. You have made ${toolsUsed.length} tool calls. Output the formatted transcript NOW — no more tool calls.`
                    : toolsUsed.length >= 5
                        ? `\n\n⚠️ You have made ${toolsUsed.length} tool calls. Make at most 1–2 more critical lookups, then output immediately.`
                        : '';

                const outputInstruction = toolsUsed.length >= 8
                    ? 'Output the formatted transcript immediately. No more tool calls.'
                    : 'If you have 1–2 remaining critical lookups, do them now. Then output the lightly formatted transcript: paragraphs at topic shifts, headings where topics clearly change, filler words removed. Keep the speaker\'s own words — do not rewrite.';

                const continuationPrompt = `Tool results processed (iteration ${iterations}, ${toolsUsed.length} tool calls made).${correctionsNote}${toolHistory}${urgencyNote}

ORIGINAL TRANSCRIPT (you must use this):
--- BEGIN TRANSCRIPT ---
${transcriptText}
--- END TRANSCRIPT ---

${outputInstruction}`;

                conversation.addUserMessage(continuationPrompt);
      
                // Continue conversation with full context
                response = await callModel('continuation', {
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
            const needsFinalRequest = !response.content || response.content.length <= 50;
            
            if (needsFinalRequest) {
                if (iterations >= maxIterations) {
                    logger.warn('Hit max iterations (%d) without final transcript — requesting explicitly (no tools)', maxIterations);
                } else {
                    logger.debug('Model did not produce transcript content, requesting explicitly...');
                }
                
                const correctionsBlock = state.resolvedEntities.size > 0
                    ? Array.from(state.resolvedEntities.entries()).map(([k, v]) => `- "${k}" should be "${v}"`).join('\n')
                    : 'None identified';
                
                const finalRequest = `You have finished analyzing. Now output the lightly formatted transcript.

ORIGINAL TRANSCRIPT:
--- BEGIN ---
${transcriptText}
--- END ---

CORRECTIONS TO APPLY:
${correctionsBlock}

Rules:
- Break into paragraphs where the speaker shifts ideas
- Add a ## heading only where topics clearly change
- Remove filler words (um, uh) and false starts
- Apply entity corrections listed above
- Keep the speaker's own words — do not rewrite or rephrase
- Preserve ALL content including asides and tangents
- Output ONLY the formatted transcript`;

                const finalResponse = await callModel('final', {
                    systemPrompt,
                    prompt: finalRequest,
                });
                
                if (finalResponse.usage) {
                    totalTokens += finalResponse.usage.totalTokens;
                }
                
                if (finalResponse.content && finalResponse.content.length > 50) {
                    const cleanedFinalContent = cleanResponseContent(finalResponse.content);
                    logCleaningWarnings(finalResponse.content, cleanedFinalContent, 'final');
                    state.correctedText = cleanedFinalContent;
                    state.confidence = 0.8;
                    logger.debug('Final transcript from explicit request: %d characters', cleanedFinalContent.length);
                } else {
                    logger.error('Enhancement FAILED: explicit request produced no content (%d chars). Falling back to raw transcript.',
                        finalResponse.content?.length || 0);
                    state.correctedText = transcriptText;
                    state.confidence = 0.5;
                }
            } else {
                const cleanedContent = cleanResponseContent(response.content);
                logCleaningWarnings(response.content, cleanedContent, 'response');
                state.correctedText = cleanedContent;
                state.confidence = 0.9;
                logger.debug('Final transcript generated: %d characters', cleanedContent.length);
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

