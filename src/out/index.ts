/**
 * Output Management System
 *
 * Main entry point for the output management system. Handles intermediate
 * files and final output destinations.
 */

import { OutputConfig, OutputPaths, IntermediateFiles, RawTranscriptData } from './types';
import * as Manager from './manager';
import * as Metadata from '../util/metadata';

export interface OutputInstance {
    createOutputPaths(
        audioFile: string,
        routedDestination: string,
        hash: string,
        date: Date
    ): OutputPaths;
    ensureDirectories(paths: OutputPaths): Promise<void>;
    writeIntermediate(
        paths: OutputPaths,
        type: keyof IntermediateFiles,
        content: unknown
    ): Promise<string>;
    /**
     * Write the raw Whisper transcript to the .transcript/ directory alongside final output.
     * This enables compare and reanalyze workflows.
     */
    writeRawTranscript(paths: OutputPaths, data: RawTranscriptData): Promise<string>;
    writeTranscript(paths: OutputPaths, content: string, metadata?: Metadata.TranscriptMetadata): Promise<string>;
    /**
     * Read a previously stored raw transcript from the .transcript/ directory.
     * Returns null if no raw transcript exists.
     */
    readRawTranscript(finalOutputPath: string): Promise<RawTranscriptData | null>;
    cleanIntermediates(paths: OutputPaths): Promise<void>;
}

export const create = (config: OutputConfig): OutputInstance => {
    return Manager.create(config);
};

export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
    intermediateDir: './output/protokoll',
    keepIntermediates: true,
    timestampFormat: 'YYMMDD-HHmm',
};

// Re-export types
export * from './types';
