/**
 * Pipeline Types
 *
 * Types for the integrated transcription pipeline that combines
 * all the new intelligent transcription modules.
 */

import { ReflectionReport } from '../reflection/types';
import { OutputPaths } from '../out/types';
import type { WeightModelProvider } from '../weighting/provider';
import type { ToolCallLogEntry } from '../agentic/types';
import type { SimpleReplaceStats } from '../phases/simple-replace';

export type { OutputPaths, SimpleReplaceStats };

export interface PipelineConfig {
    // Model settings
    model: string;
    transcriptionModel: string;
    reasoningLevel?: 'low' | 'medium' | 'high';
  
    // Feature flags
    interactive: boolean;
    selfReflection: boolean;
    debug: boolean;
    dryRun?: boolean;
    silent?: boolean;  // Disable sound notifications
  
    // Paths
    contextDirectory?: string;
    /** Explicit context directories (from protokoll-config.yaml) */
    contextDirectories?: string[];
    intermediateDir: string;
    keepIntermediates: boolean;
    processedDirectory?: string;
    
    // Optional: Entity affinity graph for LLM prepositioning
    weightModelProvider?: WeightModelProvider;
    
    // Optional: Callback for weight model updates after transcript processing
    onTranscriptEntitiesUpdated?: (transcriptUuid: string, entityIds: string[], projectId?: string) => void;
}

export interface ProgressInfo {
    current: number;
    total: number;
}

export interface PipelineInput {
    audioFile: string;
    creation: Date;
    hash: string;
    progress?: ProgressInfo;
    /** Called just before each tool executes — enables incremental PKL status writes */
    onToolCallStart?: (tool: string, input: Record<string, unknown>) => void;
    /** Called after each tool completes — enables incremental PKL log writes */
    onToolCallComplete?: (entry: ToolCallLogEntry) => void;
    /**
     * Called after the simple-replace phase completes.
     * Lets callers (e.g. the transcription worker) write the corrections to the
     * PKL enhancement log so they appear on the Enhancement tab.
     */
    onSimpleReplaceComplete?: (stats: SimpleReplaceStats) => void;
}

export type { ToolCallLogEntry };

export interface PipelineResult {
    // Core output
    outputPath: string;
    enhancedText: string;
  
    // Raw data
    rawTranscript: string;
  
    // Title derived from path or LLM
    title: string;

    // Routing info
    routedProject: string | null;
    routedProjectName: string | null;
    routingConfidence: number;

    // Entity references detected during processing (people, projects, terms, companies)
    entities?: {
        people?: Array<{ id: string; name: string; type: 'person' | 'project' | 'term' | 'company' }>;
        projects?: Array<{ id: string; name: string; type: 'person' | 'project' | 'term' | 'company' }>;
        terms?: Array<{ id: string; name: string; type: 'person' | 'project' | 'term' | 'company' }>;
        companies?: Array<{ id: string; name: string; type: 'person' | 'project' | 'term' | 'company' }>;
    };
  
    // Processing metrics
    processingTime: number;
    toolsUsed: string[];
    correctionsApplied: number;
  
    // File management
    processedAudioPath?: string;
  
    // Optional outputs
    reflection?: ReflectionReport;
    // session?: InteractiveSession; // Interactive moved to protokoll-cli
    intermediatePaths?: OutputPaths;
}

export interface PipelineState {
    input: PipelineInput;
    rawTranscript?: string;
    enhancedText?: string;
    routedDestination?: string;
    startTime: Date;
}

