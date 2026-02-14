/**
 * Feedback Handler
 * 
 * Handles the interactive feedback process - collecting user input,
 * analyzing it, and applying learned updates.
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import { ClassificationFeedback, ClassificationDecision, FeedbackAnalysis, LearningUpdate } from './types';
import * as Analyzer from './analyzer';
import * as Logging from '../logging';

// CLI output helper - allowed for interactive CLI
// eslint-disable-next-line no-console
const print = console.log;

export interface HandlerInstance {
    collectFeedback(decision: ClassificationDecision): Promise<ClassificationFeedback | null>;
    processFeedback(feedback: ClassificationFeedback): Promise<FeedbackAnalysis>;
    reviewAndApply(analysis: FeedbackAnalysis): Promise<LearningUpdate[]>;
    saveFeedback(feedback: ClassificationFeedback, analysis: FeedbackAnalysis): Promise<void>;
}

export interface HandlerConfig {
    feedbackDir: string;
    interactive: boolean;
}

const createReadlineInterface = () => {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
};

const askQuestion = (rl: readline.Interface, question: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
};

export const create = (
    analyzer: Analyzer.AnalyzerInstance,
    config: HandlerConfig
): HandlerInstance => {
    const logger = Logging.getLogger();

    const collectFeedback = async (decision: ClassificationDecision): Promise<ClassificationFeedback | null> => {
        if (!config.interactive) {
            logger.warn('Feedback collection requires interactive mode');
            return null;
        }

        const rl = createReadlineInterface();

        try {
            print('\n' + '─'.repeat(60));
            print('[Classification Feedback]');
            print('─'.repeat(60));
            print(`\nFile: ${decision.audioFile}`);
            print(`\nTranscript preview:`);
            print(`  "${decision.transcriptPreview.substring(0, 200)}..."`);
            print(`\nCurrent Classification:`);
            print(`  Project: ${decision.projectId || '(default)'}`);
            print(`  Destination: ${decision.destination}`);
            print(`  Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
            print(`  Reasoning: ${decision.reasoningTrace.finalReasoning}`);
            print('');

            // Ask if classification was correct
            const wasCorrect = await askQuestion(rl, 'Was this classification correct? (y/n): ');
            
            if (wasCorrect.toLowerCase() === 'y' || wasCorrect.toLowerCase() === 'yes') {
                print('Great! No feedback needed.');
                rl.close();
                return null;
            }

            // Collect correction
            print('\nPlease provide the correct classification:');
            
            const correctProject = await askQuestion(rl, 
                'Correct project ID (or "new" to create, Enter to skip): '
            );
            
            let newProjectName: string | undefined;
            if (correctProject.toLowerCase() === 'new') {
                newProjectName = await askQuestion(rl, 'New project name: ');
            }

            const correctDestination = await askQuestion(rl,
                'Correct destination path (Enter to skip): '
            );

            const topicsInput = await askQuestion(rl,
                'Topics for this note (comma-separated, Enter to skip): '
            );
            const topics = topicsInput ? topicsInput.split(',').map(t => t.trim()) : undefined;

            const contextType = await askQuestion(rl,
                'Context type - work/personal/mixed (Enter to skip): '
            );

            print('\nPlease explain why the original classification was wrong:');
            const userReason = await askQuestion(rl, '> ');

            rl.close();

            const feedback: ClassificationFeedback = {
                transcriptPath: decision.audioFile,
                originalDecision: {
                    projectId: decision.projectId,
                    destination: decision.destination,
                    confidence: decision.confidence,
                    reasoning: decision.reasoningTrace.finalReasoning,
                },
                correction: {
                    projectId: correctProject === 'new' ? newProjectName : (correctProject || undefined),
                    destination: correctDestination || undefined,
                    topics,
                    contextType: contextType as 'work' | 'personal' | 'mixed' | undefined,
                },
                userReason,
                providedAt: new Date(),
            };

            return feedback;

        } catch (error) {
            logger.error('Error collecting feedback', { error });
            rl.close();
            return null;
        }
    };

    const processFeedback = async (feedback: ClassificationFeedback): Promise<FeedbackAnalysis> => {
        print('\nAnalyzing feedback with reasoning model...');
        return analyzer.analyze(feedback);
    };

    const reviewAndApply = async (analysis: FeedbackAnalysis): Promise<LearningUpdate[]> => {
        if (!config.interactive) {
            // In non-interactive mode, auto-apply high-confidence updates
            const highConfidence = analysis.suggestedUpdates.filter(u => u.confidence >= 0.8);
            if (highConfidence.length > 0) {
                await analyzer.applyUpdates(highConfidence);
            }
            return highConfidence;
        }

        const rl = createReadlineInterface();

        try {
            print('\n' + '─'.repeat(60));
            print('[Feedback Analysis Results]');
            print('─'.repeat(60));
            print(`\nDiagnosis: ${analysis.diagnosis}`);
            print(`Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);

            if (analysis.suggestedUpdates.length === 0) {
                print('\nNo context updates suggested.');
                rl.close();
                return [];
            }

            print(`\nSuggested Updates (${analysis.suggestedUpdates.length}):`);
            
            const approvedUpdates: LearningUpdate[] = [];

            for (let i = 0; i < analysis.suggestedUpdates.length; i++) {
                const update = analysis.suggestedUpdates[i];
                print(`\n${i + 1}. [${update.type}] ${update.entityType}: ${update.entityId}`);
                print(`   Reasoning: ${update.reasoning}`);
                print(`   Confidence: ${(update.confidence * 100).toFixed(1)}%`);
                print('   Changes:');
                for (const change of update.changes) {
                    print(`     - ${change.field}: ${JSON.stringify(change.newValue)}`);
                }

                const approve = await askQuestion(rl, `   Apply this update? (y/n/edit): `);
                
                if (approve.toLowerCase() === 'y' || approve.toLowerCase() === 'yes') {
                    approvedUpdates.push(update);
                } else if (approve.toLowerCase() === 'edit') {
                    // Allow editing the update
                    print('   (Editing not yet implemented, skipping)');
                }
            }

            rl.close();

            if (approvedUpdates.length > 0) {
                print(`\nApplying ${approvedUpdates.length} updates...`);
                await analyzer.applyUpdates(approvedUpdates);
                print('Updates applied successfully.');
            }

            return approvedUpdates;

        } catch (error) {
            logger.error('Error reviewing updates', { error });
            rl.close();
            return [];
        }
    };

    const saveFeedback = async (feedback: ClassificationFeedback, analysis: FeedbackAnalysis): Promise<void> => {
        // Ensure feedback directory exists
        await fs.mkdir(config.feedbackDir, { recursive: true });

        // Create feedback record
        const record = {
            feedback,
            analysis,
            savedAt: new Date().toISOString(),
        };

        // Save with timestamp
        const filename = `feedback-${Date.now()}.json`;
        const filepath = path.join(config.feedbackDir, filename);
        
        await fs.writeFile(filepath, JSON.stringify(record, null, 2), 'utf-8');
        logger.info('Saved feedback to: %s', filepath);
    };

    return { collectFeedback, processFeedback, reviewAndApply, saveFeedback };
};

