/**
 * Transcription Service
 * 
 * Handles audio transcription using OpenAI's transcription models.
 * Keeps transcription simple - the complexity is in the reasoning pass.
 */

import OpenAI from 'openai';
import * as Storage from '../util/storage';
import * as Media from '../util/media';
import {
    TranscriptionRequest,
    TranscriptionResult,
    TranscriptionModel,
    MODEL_CAPABILITIES
} from './types';
import * as Logging from '../logging';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ServiceInstance {
    transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
    supportsStreaming(model: TranscriptionModel): boolean;
    supportsDiarization(model: TranscriptionModel): boolean;
}

// Alias for backwards compatibility
export type TranscriptionService = ServiceInstance;

export const create = (openai: OpenAI): ServiceInstance => {
    const logger = Logging.getLogger();
    const storage = Storage.create({ log: logger.debug });
    const media = Media.create(logger);

    const supportsStreaming = (model: TranscriptionModel): boolean => {
        return MODEL_CAPABILITIES[model]?.supportsStreaming ?? false;
    };

    const supportsDiarization = (model: TranscriptionModel): boolean => {
        return MODEL_CAPABILITIES[model]?.supportsDiarization ?? false;
    };

    const transcribe = async (request: TranscriptionRequest): Promise<TranscriptionResult> => {
        const { audioFile, config } = request;

        logger.debug('Starting transcription', { model: config.model, file: audioFile });

        // OpenAI API has a 25MB limit for audio files
        const MAX_AUDIO_SIZE = 26214400; // 25MB in bytes
        const tempDir = path.join(os.tmpdir(), 'protokoll-conversions');

        // Check original file size first
        const originalFileSize = await media.getFileSize(audioFile);
        const originalFileSizeMB = (originalFileSize / (1024 * 1024)).toFixed(1);
        logger.debug(`Original audio file size: ${originalFileSize} bytes (${originalFileSizeMB} MB)`);

        // Convert audio file to a supported format if necessary
        // Force conversion if file is close to or over the size limit to ensure compression
        const needsConversion = originalFileSize > (MAX_AUDIO_SIZE * 0.95); // Convert if within 5% of limit
        const convertedAudioFile = needsConversion 
            ? await media.convertToSupportedFormat(audioFile, tempDir, true) // Force conversion
            : await media.convertToSupportedFormat(audioFile, tempDir);
        logger.debug(`Using audio file for transcription: ${convertedAudioFile}`);

        // Check if audio file exceeds the size limit after conversion
        const fileSize = await media.getFileSize(convertedAudioFile);
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        logger.debug(`Audio file size: ${fileSize} bytes (${fileSizeMB} MB), max size: ${MAX_AUDIO_SIZE} bytes`);

        let transcriptionText: string;
        let totalDuration = 0;

        if (fileSize > MAX_AUDIO_SIZE) {
            logger.info(`Audio file exceeds maximum size (${fileSize} > ${MAX_AUDIO_SIZE} bytes), splitting into chunks`);

            // Create a temporary directory for the audio chunks
            const splitTempDir = path.join(tempDir, `split_audio_${Date.now()}`);
            await storage.createDirectory(splitTempDir);

            try {
                // Split the audio file into chunks
                const audioChunks = await media.splitAudioFile(convertedAudioFile, splitTempDir, MAX_AUDIO_SIZE);
                logger.info(`Split audio file into ${audioChunks.length} chunks`);

                // Transcribe each chunk
                const transcriptions: string[] = [];
                for (let i = 0; i < audioChunks.length; i++) {
                    const chunkPath = audioChunks[i];
                    logger.info(`Transcribing chunk ${i + 1}/${audioChunks.length}: ${chunkPath}`);

                    const chunkStream = await storage.readStream(chunkPath);
                    const chunkStartTime = Date.now();
                    
                    const chunkResponse = await openai.audio.transcriptions.create({
                        model: config.model,
                        file: chunkStream,
                        response_format: config.response_format ?? 'json',
                        ...(config.language && { language: config.language }),
                        ...(config.temperature !== undefined && { temperature: config.temperature }),
                        ...(config.prompt && { prompt: config.prompt }),
                    });

                    const chunkDuration = Date.now() - chunkStartTime;
                    totalDuration += chunkDuration;
                    transcriptions.push(chunkResponse.text);
                }

                // Combine all transcriptions
                transcriptionText = transcriptions.join(' ');

                // Clean up temporary chunks
                for (const chunk of audioChunks) {
                    try {
                        await storage.deleteFile(chunk);
                    } catch (error) {
                        logger.warn(`Failed to delete temporary chunk ${chunk}: ${error}`);
                    }
                }
                
                // Clean up split directory
                try {
                    await storage.deleteDirectory(splitTempDir);
                } catch (error) {
                    logger.warn(`Failed to delete temporary split directory ${splitTempDir}: ${error}`);
                }
            } catch (error) {
                logger.error(`Error processing split audio files: ${error}`);
                throw new Error(`Failed to process split audio files: ${error}`);
            }
        } else {
            // If file size is within the limit, transcribe normally
            const audioStream = await storage.readStream(convertedAudioFile);
        
            // Execute transcription
            const startTime = Date.now();
            const response = await openai.audio.transcriptions.create({
                model: config.model,
                file: audioStream,
                response_format: config.response_format ?? 'json',
                ...(config.language && { language: config.language }),
                ...(config.temperature !== undefined && { temperature: config.temperature }),
                ...(config.prompt && { prompt: config.prompt }),
            });
            totalDuration = Date.now() - startTime;
            transcriptionText = response.text;
        }
    
        logger.debug('Transcription complete', { duration: totalDuration, model: config.model });
    
        // Handle the response
        return {
            text: transcriptionText,
            model: config.model,
            duration: totalDuration,
        };
    };
  
    return {
        transcribe,
        supportsStreaming,
        supportsDiarization,
    };
};
