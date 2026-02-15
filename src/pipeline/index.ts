/**
 * Pipeline Integration
 *
 * Main entry point for the intelligent transcription pipeline.
 * Brings together all modules into a unified processing flow.
 * 
 * THIS IS THE MAIN ENTRY POINT - USE Pipeline.create() IN protokoll.ts
 */

import { PipelineInput, PipelineResult } from './types';
import * as Orchestrator from './orchestrator';

export interface PipelineInstance {
    process(input: PipelineInput): Promise<PipelineResult>;
}

export type { OrchestratorConfig } from './orchestrator';

export const create = async (config: Orchestrator.OrchestratorConfig): Promise<PipelineInstance> => {
    return Orchestrator.create(config);
};

export const DEFAULT_PIPELINE_CONFIG: Partial<Orchestrator.OrchestratorConfig> = {
    model: 'gpt-5.2',
    transcriptionModel: 'whisper-1',
    interactive: false,
    selfReflection: true,
    debug: false,
    intermediateDir: './output/protokoll',
    keepIntermediates: true,
    outputDirectory: './output',
    outputStructure: 'month',
    outputFilenameOptions: ['date', 'time', 'subject'],
    maxAudioSize: 25 * 1024 * 1024,
    tempDirectory: '/tmp',
};

// Re-export types
export * from './types';

