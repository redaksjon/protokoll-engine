/**
 * Transcription System Types
 * 
 * Supports multiple OpenAI transcription models with different capabilities.
 * The transcription service produces raw phonetic output that will be
 * corrected by the full reasoning pass.
 */

export type TranscriptionModel = 
    | 'whisper-1'
    | 'gpt-4o-mini-transcribe'
    | 'gpt-4o-transcribe'
    | 'gpt-4o-transcribe-diarize';

export interface TranscriptionConfig {
    model: TranscriptionModel;
    language?: string;
    prompt?: string;
    response_format?: 'json' | 'text' | 'verbose_json' | 'srt' | 'vtt';
    temperature?: number;
    streaming?: boolean;
}

export interface TranscriptionRequest {
    audioFile: string;                    // Path to audio file
    config: TranscriptionConfig;
    contextPrompt?: string;               // Built from known entities (limited to 224 tokens)
}

export interface TranscriptionSegment {
    start: number;
    end: number;
    text: string;
    speaker?: string;  // For diarization
}

export interface TranscriptionResult {
    text: string;
    model: string;
    segments?: TranscriptionSegment[];
    duration?: number;
    language?: string;
}

export interface ModelCapabilities {
    supportsStreaming: boolean;
    supportsDiarization: boolean;
    maxFileSize: number;
}

export const MODEL_CAPABILITIES: Record<TranscriptionModel, ModelCapabilities> = {
    'whisper-1': {
        supportsStreaming: false,
        supportsDiarization: false,
        maxFileSize: 25 * 1024 * 1024,  // 25 MB
    },
    'gpt-4o-mini-transcribe': {
        supportsStreaming: true,
        supportsDiarization: false,
        maxFileSize: 25 * 1024 * 1024,
    },
    'gpt-4o-transcribe': {
        supportsStreaming: true,
        supportsDiarization: false,
        maxFileSize: 25 * 1024 * 1024,
    },
    'gpt-4o-transcribe-diarize': {
        supportsStreaming: true,
        supportsDiarization: true,
        maxFileSize: 25 * 1024 * 1024,
    },
};

