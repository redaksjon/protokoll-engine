/**
 * Feedback Analyzer
 * 
 * Uses a reasoning model to analyze user feedback on classification
 * decisions and suggest context updates.
 */

import { ClassificationFeedback, FeedbackAnalysis, LearningUpdate } from './types';
import * as Reasoning from '../reasoning';
import * as Context from '../context';
import * as Logging from '../logging';

export interface AnalyzerInstance {
    analyze(feedback: ClassificationFeedback): Promise<FeedbackAnalysis>;
    applyUpdates(updates: LearningUpdate[]): Promise<void>;
}

export interface AnalyzerConfig {
    model: string;
    autoApplyThreshold: number;
}

export const create = (
    reasoning: Reasoning.ReasoningInstance,
    context: Context.ContextInstance,
    config: AnalyzerConfig
): AnalyzerInstance => {
    const logger = Logging.getLogger();

    const analyze = async (feedback: ClassificationFeedback): Promise<FeedbackAnalysis> => {
        logger.info('Analyzing feedback for: %s', feedback.transcriptPath);

        // Gather current context for the model to understand
        const allProjects = context.getAllProjects();
        const projectSummary = allProjects.map(p => ({
            id: p.id,
            name: p.name,
            phrases: p.classification?.explicit_phrases || [],
            topics: p.classification?.topics || [],
            contextType: p.classification?.context_type,
            destination: p.routing?.destination,
        }));

        const prompt = `You are analyzing why a transcription routing system made a classification error.

## Original Classification Decision
- **Chosen Project**: ${feedback.originalDecision.projectId || 'none (default routing)'}
- **Destination**: ${feedback.originalDecision.destination}
- **Confidence**: ${(feedback.originalDecision.confidence * 100).toFixed(1)}%
- **System's Reasoning**: ${feedback.originalDecision.reasoning}

## User's Correction
- **Correct Project**: ${feedback.correction.projectId || 'not specified'}
- **Correct Destination**: ${feedback.correction.destination || 'not specified'}
- **Topics**: ${feedback.correction.topics?.join(', ') || 'not specified'}
- **Context Type**: ${feedback.correction.contextType || 'not specified'}

## User's Explanation
"${feedback.userReason}"

## Current Project Context
${JSON.stringify(projectSummary, null, 2)}

## Your Task
Analyze why the classification failed and suggest specific updates to the context system.

Return a JSON object with:
1. "diagnosis": A clear explanation of what went wrong
2. "suggestedUpdates": Array of updates to make, each with:
   - "type": "new_project" | "new_phrase" | "new_topic" | "context_type" | "association"
   - "entityType": "project" | "person" | "company" | "term"
   - "entityId": The entity to update (or new ID if creating)
   - "changes": Array of { "field": string, "newValue": any }
   - "reasoning": Why this update helps
   - "confidence": 0-1 how confident you are
3. "clarificationQuestions": Optional questions if more info needed
4. "confidence": Overall confidence in this analysis (0-1)

Focus on:
- Missing trigger phrases that should match the correct project
- Topics that should be associated with projects
- Context type mismatches (work vs personal)
- New projects that need to be created

Respond with ONLY the JSON object.`;

        try {
            const response = await reasoning.complete({
                systemPrompt: 'You are an expert at analyzing classification systems and suggesting improvements. Always respond with valid JSON.',
                prompt,
            });

            // Parse the response
            const analysis = JSON.parse(response.content) as FeedbackAnalysis;
            logger.info('Feedback analysis complete: %d suggested updates', analysis.suggestedUpdates.length);

            return analysis;
        } catch (error) {
            logger.error('Failed to analyze feedback', { error });
            
            // Return a basic analysis if reasoning fails
            return {
                diagnosis: 'Unable to analyze feedback automatically. Manual review recommended.',
                suggestedUpdates: [],
                confidence: 0,
            };
        }
    };

    const applyUpdates = async (updates: LearningUpdate[]): Promise<void> => {
        logger.info('Applying %d context updates', updates.length);

        for (const update of updates) {
            // Skip low-confidence updates unless auto-apply threshold is 0
            if (update.confidence < config.autoApplyThreshold) {
                logger.info('Skipping low-confidence update: %s (%.1f%% < %.1f%%)',
                    update.entityId, 
                    update.confidence * 100, 
                    config.autoApplyThreshold * 100
                );
                continue;
            }

            try {
                if (update.type === 'new_project') {
                    // Create new project
                    const classification: {
                        context_type: 'work' | 'personal' | 'mixed';
                        explicit_phrases: string[];
                        topics: string[];
                    } = {
                        context_type: 'work',
                        explicit_phrases: [],
                        topics: [],
                    };
                    
                    const newProject: {
                        id: string;
                        name: string;
                        type: 'project';
                        description: string;
                        classification: typeof classification;
                        routing: {
                            destination?: string;
                            structure: 'none' | 'year' | 'month' | 'day';
                            filename_options: Array<'date' | 'time' | 'subject'>;
                        };
                        active: boolean;
                    } = {
                        id: update.entityId,
                        name: update.entityId,
                        type: 'project' as const,
                        description: update.reasoning,
                        classification,
                        routing: {
                            // No destination - will use global default
                            structure: 'month' as const,
                            filename_options: ['date', 'time', 'subject'] as Array<'date' | 'time' | 'subject'>,
                        },
                        active: true,
                    };

                    // Apply changes
                    for (const change of update.changes) {
                        if (change.field === 'name') newProject.name = String(change.newValue);
                        if (change.field === 'destination') newProject.routing.destination = String(change.newValue);
                        if (change.field === 'context_type') {
                            newProject.classification.context_type = change.newValue as 'work' | 'personal' | 'mixed';
                        }
                        if (change.field === 'explicit_phrases') {
                            newProject.classification.explicit_phrases = change.newValue as string[];
                        }
                        if (change.field === 'topics') {
                            newProject.classification.topics = change.newValue as string[];
                        }
                    }

                    await context.saveEntity(newProject);
                    logger.info('Created new project: %s', update.entityId);

                } else if (update.type === 'new_phrase' || update.type === 'new_topic' || update.type === 'context_type') {
                    // Update existing project
                    const existing = context.getProject(update.entityId);
                    if (!existing) {
                        logger.warn('Project not found for update: %s', update.entityId);
                        continue;
                    }

                    // Create updated entity
                    const updated = { ...existing };
                    
                    for (const change of update.changes) {
                        if (change.field === 'explicit_phrases') {
                            const newPhrases = change.newValue as string[];
                            updated.classification = {
                                ...updated.classification,
                                explicit_phrases: [
                                    ...(updated.classification?.explicit_phrases || []),
                                    ...newPhrases.filter(p => 
                                        !updated.classification?.explicit_phrases?.includes(p)
                                    ),
                                ],
                            };
                        }
                        if (change.field === 'topics') {
                            const newTopics = change.newValue as string[];
                            updated.classification = {
                                ...updated.classification,
                                topics: [
                                    ...(updated.classification?.topics || []),
                                    ...newTopics.filter(t => 
                                        !updated.classification?.topics?.includes(t)
                                    ),
                                ],
                            };
                        }
                        if (change.field === 'context_type') {
                            updated.classification = {
                                ...updated.classification,
                                context_type: change.newValue as 'work' | 'personal' | 'mixed',
                            };
                        }
                    }

                    await context.saveEntity(updated);
                    logger.info('Updated project: %s', update.entityId);
                }
            } catch (error) {
                logger.error('Failed to apply update', { update, error });
            }
        }
    };

    return { analyze, applyUpdates };
};

