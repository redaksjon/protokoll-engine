/**
 * Feedback System
 * 
 * Provides mechanisms for users to correct classification decisions
 * and have the system learn from those corrections.
 * 
 * Usage:
 *   protokoll feedback --file <transcript.md>
 *   protokoll feedback --recent
 */

import { FeedbackConfig, ClassificationDecision, ClassificationFeedback, FeedbackAnalysis, LearningUpdate } from './types';
import * as Handler from './handler';
import * as Analyzer from './analyzer';
import * as Reasoning from '../reasoning';
import * as Context from '../context';

export interface FeedbackInstance {
    collectAndProcess(decision: ClassificationDecision): Promise<{
        feedback: ClassificationFeedback | null;
        analysis?: FeedbackAnalysis;
        appliedUpdates?: LearningUpdate[];
    }>;
}

export const create = async (
    config: FeedbackConfig,
    context: Context.ContextInstance
): Promise<FeedbackInstance> => {
    // Initialize reasoning for analysis
    const reasoning = Reasoning.create({ model: config.reasoningModel });

    // Create analyzer
    const analyzer = Analyzer.create(reasoning, context, {
        model: config.reasoningModel,
        autoApplyThreshold: config.autoApplyThreshold,
    });

    // Create handler
    const handler = Handler.create(analyzer, {
        feedbackDir: config.feedbackDir,
        interactive: true,
    });

    const collectAndProcess = async (decision: ClassificationDecision) => {
        // Collect feedback from user
        const feedback = await handler.collectFeedback(decision);
        
        if (!feedback) {
            return { feedback: null };
        }

        // Analyze with reasoning model
        const analysis = await handler.processFeedback(feedback);

        // Review and apply updates
        const appliedUpdates = await handler.reviewAndApply(analysis);

        // Save feedback for future reference
        await handler.saveFeedback(feedback, analysis);

        return { feedback, analysis, appliedUpdates };
    };

    return { collectAndProcess };
};

// Re-export types
export * from './types';

