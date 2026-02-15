/**
 * Self-Reflection Types
 *
 * Types for tracking and reporting on transcription quality and tool effectiveness.
 */

export interface TranscriptionMetrics {
    // Timing
    startTime: Date;
    endTime: Date;
    totalDuration: number;        // ms
    whisperDuration: number;      // ms
    reasoningDuration: number;    // ms
  
    // Tool usage
    iterations: number;
    toolCallsExecuted: number;
    toolsUsed: string[];
  
    // Content metrics
    originalLength: number;       // characters
    correctedLength: number;      // characters
    correctionsApplied: number;
    unknownEntitiesFound: number;
    entitiesResolved: number;
  
    // Model info
    model: string;
    tokensUsed: number;
}

export interface ToolEffectiveness {
    name: string;
    callCount: number;
    successCount: number;
    failureCount: number;
    avgDuration: number;          // ms
    successRate: number;          // 0-1
}

export interface QualityAssessment {
    confidence: number;           // 0-1 overall confidence
    nameAccuracy: number;         // 0-1 estimated name accuracy
    routingConfidence: number;    // 0-1 routing decision confidence
    contentPreservation: number;  // 0-1 how much content preserved
    overallScore: number;         // 0-1 composite score
}

export interface Recommendation {
    type: 'tool-issue' | 'context-gap' | 'performance' | 'quality';
    severity: 'high' | 'medium' | 'low';
    message: string;
    suggestion?: string;
}

export interface ContextChange {
    entityType: 'person' | 'project' | 'company' | 'term' | 'ignored';
    entityId: string;
    entityName: string;
    action: 'created' | 'updated';
    details?: Record<string, unknown>;
}

export interface RoutingDecisionRecord {
    // What was decided
    projectId: string | null;
    destination: string;
    confidence: number;
    
    // Why it was decided - the reasoning trace
    reasoning: string;
    
    // What signals contributed to the decision
    signals: Array<{
        type: string;
        value: string;
        weight: number;
        source?: string;  // Where this signal came from (e.g., "context/projects/alpha.yaml")
    }>;
    
    // Other projects that were considered
    alternativesConsidered?: Array<{
        projectId: string;
        confidence: number;
        whyNotChosen: string;
    }>;
    
    // Was this decision confirmed by user? (interactive mode)
    userConfirmed?: boolean;
    
    // Was this decision later corrected via feedback?
    feedbackProvided?: boolean;
    feedbackCorrection?: string;
}

export interface ReflectionReport {
    id: string;
    generated: Date;
    audioFile: string;
    outputFile: string;
  
    // Summary
    summary: {
        duration: number;
        iterations: number;
        toolCalls: number;
        corrections: number;
        confidence: number;
    };
  
    // Detailed metrics
    metrics: TranscriptionMetrics;
  
    // Tool analysis
    toolEffectiveness: ToolEffectiveness[];
  
    // Quality
    quality: QualityAssessment;
  
    // Recommendations
    recommendations: Recommendation[];
  
    // Routing decision with full reasoning trace
    routingDecision?: RoutingDecisionRecord;
  
    // Context changes made during session
    contextChanges?: ContextChange[];
  
    // Optional: Include conversation history
    conversationHistory?: unknown[];
  
    // Optional: Include final output
    output?: string;
}

export interface ReflectionConfig {
    enabled: boolean;
    outputPath?: string;          // Default: alongside other intermediates
    format: 'markdown' | 'json';
    includeConversation: boolean;
    includeOutput: boolean;
}

