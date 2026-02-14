/**
 * Feedback System Types
 * 
 * Types for capturing user feedback on classification decisions
 * and learning from corrections.
 */

export interface ClassificationFeedback {
    // The transcript file that was misclassified
    transcriptPath: string;
    
    // What the system chose
    originalDecision: {
        projectId: string | null;
        destination: string;
        confidence: number;
        reasoning: string;
    };
    
    // What the user says it should have been
    correction: {
        projectId?: string;
        destination?: string;
        topics?: string[];
        contextType?: 'work' | 'personal' | 'mixed';
    };
    
    // User's explanation
    userReason: string;
    
    // Timestamp
    providedAt: Date;
}

export interface LearningUpdate {
    // What type of update
    type: 'new_project' | 'new_phrase' | 'new_topic' | 'context_type' | 'association';
    
    // Target entity
    entityType: 'project' | 'person' | 'company' | 'term';
    entityId: string;
    
    // What changed
    changes: {
        field: string;
        oldValue?: unknown;
        newValue: unknown;
    }[];
    
    // Why (from reasoning model)
    reasoning: string;
    
    // Confidence in this update
    confidence: number;
}

export interface FeedbackAnalysis {
    // What went wrong
    diagnosis: string;
    
    // Suggested context updates
    suggestedUpdates: LearningUpdate[];
    
    // Questions to ask user for clarification
    clarificationQuestions?: string[];
    
    // Model's confidence in the analysis
    confidence: number;
}

export interface ClassificationDecision {
    // For tracking/auditing
    id: string;
    timestamp: Date;
    
    // Input
    transcriptPreview: string;
    audioFile: string;
    
    // Decision
    projectId: string | null;
    destination: string;
    confidence: number;
    
    // Reasoning trace - why this decision was made
    reasoningTrace: {
        signalsDetected: Array<{
            type: string;
            value: string;
            weight: number;
            source: string;
        }>;
        projectsConsidered: Array<{
            projectId: string;
            score: number;
            matchedSignals: string[];
        }>;
        finalReasoning: string;
    };
    
    // Whether user has provided feedback
    feedbackStatus?: 'none' | 'correct' | 'incorrect';
    feedback?: ClassificationFeedback;
}

export interface FeedbackConfig {
    // Where to store feedback history
    feedbackDir: string;
    
    // Model for analyzing feedback
    reasoningModel: string;
    
    // Auto-apply high-confidence updates?
    autoApplyThreshold: number;
}

