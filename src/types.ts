/**
 * Core Types
 * 
 * Shared type definitions for the Protokoll library.
 */

import * as Dreadcabinet from '@utilarium/dreadcabinet';
import * as Cardigantime from '@utilarium/cardigantime';

/**
 * Configuration interface for Protokoll processing
 */
export interface Config extends Dreadcabinet.Args, Cardigantime.Args {
    dryRun?: boolean;
    verbose?: boolean;
    debug?: boolean;
    transcriptionModel?: string;
    model?: string;
    reasoningLevel?: 'low' | 'medium' | 'high';
    openaiApiKey?: string;
    overrides?: boolean;
    contextDirectories?: string[];
    maxAudioSize?: number | string;
    tempDirectory?: string;
    batch?: boolean;
    selfReflection?: boolean;
    silent?: boolean;
    processedDirectory?: string;
}
