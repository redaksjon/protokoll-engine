/**
 * Pipeline Types
 *
 * Types for the integrated transcription pipeline that combines
 * all the new intelligent transcription modules.
 */

import { ReflectionReport } from '../reflection/types';

// OutputPaths type (inline definition)
export interface OutputPaths {
    output: string;
    final: string;
    intermediate: {
        [key: string]: string;
    };
    [key: string]: string | { [key: string]: string };
}

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
}

export interface PipelineResult {
    // Core output
    outputPath: string;
    enhancedText: string;
  
    // Raw data
    rawTranscript: string;
  
    // Routing info
    routedProject: string | null;
    routingConfidence: number;
  
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

