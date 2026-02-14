/**
 * Transcription System
 * 
 * Main entry point for the transcription system. Provides a factory function
 * to create transcription instances that can transcribe audio files using
 * various OpenAI models.
 * 
 * Design Philosophy:
 * - Keep transcription simple - it produces raw phonetic output
 * - The reasoning pass handles corrections with full context
 * - Model choice is user preference (quality vs cost)
 */

import OpenAI from 'openai';
import { TranscriptionConfig, TranscriptionResult, TranscriptionModel } from './types';
import * as Service from './service';

export interface TranscriptionInstance {
    // Core transcription
    transcribe(audioFile: string, options?: Partial<TranscriptionConfig>): Promise<TranscriptionResult>;
  
    // Model capabilities
    supportsStreaming(model: TranscriptionModel): boolean;
    supportsDiarization(model: TranscriptionModel): boolean;
  
    // Configuration
    setDefaultModel(model: TranscriptionModel): void;
    getDefaultModel(): TranscriptionModel;
}

export interface CreateOptions {
    apiKey?: string;
    defaultModel?: TranscriptionModel;
    openaiClient?: OpenAI;
}

export const create = (options: CreateOptions = {}): TranscriptionInstance => {
    // Lazy-initialize OpenAI client (only when actually needed for transcription)
    let service: Service.ServiceInstance | null = null;
    const getService = (): Service.ServiceInstance => {
        if (!service) {
            const openai = options.openaiClient ?? new OpenAI({ apiKey: options.apiKey });
            service = Service.create(openai);
        }
        return service;
    };
  
    let defaultModel: TranscriptionModel = options.defaultModel ?? 'whisper-1';
  
    const transcribe = async (
        audioFile: string, 
        configOptions: Partial<TranscriptionConfig> = {}
    ): Promise<TranscriptionResult> => {
        return getService().transcribe({
            audioFile,
            config: {
                model: configOptions.model ?? defaultModel,
                ...configOptions,
            },
        });
    };
  
    return {
        transcribe,
        supportsStreaming: (model) => getService().supportsStreaming(model),
        supportsDiarization: (model) => getService().supportsDiarization(model),
        setDefaultModel: (model) => { defaultModel = model; },
        getDefaultModel: () => defaultModel,
    };
};

// Re-export types
export * from './types';

