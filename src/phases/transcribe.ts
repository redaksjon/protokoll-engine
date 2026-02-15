import * as Dreadcabinet from '@utilarium/dreadcabinet';
import { Config } from '@/types';
import * as Logging from '@/logging';
import * as Storage from '@/util/storage';
import * as Media from '@/util/media';
import * as OpenAI from '@/util/openai';
import { stringifyJSON } from '@/util/general';
import path from 'node:path';
import * as Agentic from '@/agentic';
import * as Reasoning from '../reasoning';
import * as Context from '@redaksjon/context';
import * as Routing from '../routing';

export interface Transcription {
    text: string;
    audioFileBasename: string;
    toolsUsed?: string[];
    agentIterations?: number;
}

export interface Instance {
    transcribe: (creation: Date, outputPath: string, contextPath: string, interimPath: string, filename: string, hash: string, audioFile: string) => Promise<Transcription>;
}

export interface TranscribeDependencies {
    contextInstance?: Context.ContextInstance;
    routingInstance?: Routing.RoutingInstance;
}

export const create = (config: Config, operator: Dreadcabinet.Operator, deps?: TranscribeDependencies): Instance => {
    const logger = Logging.getLogger();
    const storage = Storage.create({ log: logger.debug });
    const media = Media.create(logger);
    
    // Create reasoning instance for agentic processing
    const reasoning = Reasoning.create({ model: config.model || 'gpt-4' });

    const transcribe = async (creation: Date, outputPath: string, contextPath: string, interimPath: string, filename: string, hash: string, audioFile: string): Promise<Transcription> => {
        if (!outputPath) {
            throw new Error("outputPath is required for transcribe function");
        }

        if (!audioFile) {
            throw new Error("audioFile is required for transcribe function");
        }

        // Remove extension from audioFile and make the name filesafe
        const audioFileBasename = path.basename(audioFile, path.extname(audioFile))
            .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace non-alphanumeric chars with underscore
            .replace(/_+/g, '_') // Replace multiple underscores with a single one
            .trim();

        logger.debug(`Processed audio filename: ${audioFileBasename}`);

        let transcriptOutputFilename = await operator.constructFilename(creation, 'transcript', hash, { subject: audioFileBasename });
        // Ensure the filename ends with .json
        if (!transcriptOutputFilename.endsWith('.json')) {
            logger.warn('constructFilename did not return a .json file for transcript, appending extension: %s', transcriptOutputFilename);
            transcriptOutputFilename += '.json';
        }

        const transcriptOutputPath = path.join(interimPath, transcriptOutputFilename);

        // Check if transcription already exists
        if (await storage.exists(transcriptOutputPath)) {
            logger.info('Transcription file %s already exists, returning existing content...', transcriptOutputPath);
            const existingContent = await storage.readFile(transcriptOutputPath, 'utf8');
            return JSON.parse(existingContent);
        }

        const baseDebugFilename = path.parse(transcriptOutputFilename).name;
        const transcriptionDebugFile = config.debug ? path.join(interimPath, `${baseDebugFilename}.transcription.raw.response.json`) : undefined;

        // Check original file size first
        const originalFileSize = await media.getFileSize(audioFile);
        const originalFileSizeMB = (originalFileSize / (1024 * 1024)).toFixed(1);
        logger.debug(`Original audio file size: ${originalFileSize} bytes (${originalFileSizeMB} MB)`);

        // Convert audio file to a supported format if necessary
        // Always convert if file is close to or over the size limit to ensure compression
        const maxAudioSize = typeof config.maxAudioSize === 'number' ? config.maxAudioSize : 25 * 1024 * 1024;
        const needsConversion = originalFileSize > (maxAudioSize * 0.95); // Convert if within 5% of limit
        const convertedAudioFile = needsConversion 
            ? await media.convertToSupportedFormat(audioFile, interimPath, true) // Force conversion
            : await media.convertToSupportedFormat(audioFile, interimPath);
        logger.debug(`Using audio file for transcription: ${convertedAudioFile}`);

        // Check if audio file exceeds the size limit after conversion
        const fileSize = await media.getFileSize(convertedAudioFile);
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        logger.info('Step 1/2: Transcribing audio (%s MB)...', fileSizeMB);
        logger.debug(`Audio file size: ${fileSize} bytes, max size: ${maxAudioSize} bytes`);

        let transcription: OpenAI.Transcription;

        if (fileSize > maxAudioSize) {
            logger.info(`Audio file exceeds maximum size (${fileSize} > ${maxAudioSize} bytes), splitting into chunks`);

            // Create a temporary directory for the audio chunks
            const tempDir = path.join(config.tempDirectory || '/tmp', `split_audio_${hash}`);
            await storage.createDirectory(tempDir);

            try {
                // Split the audio file into chunks (use converted file)
                const audioChunks = await media.splitAudioFile(convertedAudioFile, tempDir, maxAudioSize);
                logger.info(`Split audio file into ${audioChunks.length} chunks`);

                // Transcribe each chunk
                const transcriptions: OpenAI.Transcription[] = [];
                for (let i = 0; i < audioChunks.length; i++) {
                    const chunkPath = audioChunks[i];
                    logger.info(`Transcribing chunk ${i + 1}/${audioChunks.length}: ${chunkPath}`);

                    const chunkDebugFile = config.debug ?
                        path.join(interimPath, `${baseDebugFilename}.transcription.chunk${i + 1}.raw.response.json`) :
                        undefined;

                    const chunkTranscription = await OpenAI.transcribeAudio(chunkPath, {
                        model: config.transcriptionModel,
                        debug: config.debug,
                        debugFile: chunkDebugFile
                    });

                    transcriptions.push(chunkTranscription);
                }

                // Combine all transcriptions
                const combinedText = transcriptions.map(t => t.text).join(' ');
                transcription = { text: combinedText };

                // Save each individual chunk for debugging
                await storage.writeFile(
                    path.join(interimPath, `${baseDebugFilename}.transcription.combined.json`),
                    stringifyJSON({ chunks: transcriptions, combined: transcription }),
                    'utf8'
                );

                // Clean up temporary files if not in debug mode
                if (!config.debug) {
                    for (const chunk of audioChunks) {
                        try {
                            await storage.deleteFile(chunk);
                        } catch (error) {
                            logger.warn(`Failed to delete temporary chunk ${chunk}: ${error}`);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error processing split audio files: ${error}`);
                throw new Error(`Failed to process split audio files: ${error}`);
            }
        } else {
            // If file size is within the limit, transcribe normally (use converted file)
            transcription = await OpenAI.transcribeAudio(convertedAudioFile, {
                model: config.transcriptionModel,
                debug: config.debug,
                debugFile: transcriptionDebugFile
            });
        }

        // Save the transcription
        await storage.writeFile(transcriptOutputPath, stringifyJSON(transcription), 'utf8');
        logger.debug('Wrote transcription to %s', transcriptOutputPath);

        // Create markdown version of the transcript using agentic approach
        const markdownOutputFilename = transcriptOutputFilename.replace('.json', '.md');
        const markdownOutputPath = path.join(outputPath, markdownOutputFilename);

        let toolsUsed: string[] = [];
        let agentIterations = 0;

        // Only create the markdown file if it doesn't already exist
        if (!await storage.exists(markdownOutputPath)) {
            logger.info('Step 2/2: Processing transcript with agentic reasoning...');
            logger.info('Transcript length: %d characters - model will use tools to query context as needed', transcription.text.length);

            // Debug file for agentic session
            const agenticDebugFile = config.debug ?
                path.join(interimPath, `${baseDebugFilename}.agentic.session.json`) :
                undefined;

            let markdownContent: string;

            // Use agentic executor if we have context/routing instances
            if (deps?.contextInstance && deps?.routingInstance) {
                logger.info('Using agentic mode - model will call tools to look up people, projects, etc.');
                
                const executor = Agentic.create(reasoning, {
                    transcriptText: transcription.text,
                    audioDate: creation,
                    sourceFile: audioFile,
                    contextInstance: deps.contextInstance,
                    routingInstance: deps.routingInstance,
                    interactiveMode: config.interactive ?? false,
                });

                const result = await executor.process(transcription.text);
                markdownContent = result.enhancedText;
                toolsUsed = result.toolsUsed;
                agentIterations = result.iterations;

                logger.info('Agentic processing complete: %d iterations, tools used: %s', 
                    agentIterations, 
                    toolsUsed.length > 0 ? toolsUsed.join(', ') : 'none');

                // Save agentic session debug info
                if (config.debug && agenticDebugFile) {
                    await storage.writeFile(agenticDebugFile, stringifyJSON({
                        toolsUsed,
                        iterations: agentIterations,
                        state: result.state,
                    }), 'utf8');
                    logger.debug('Wrote agentic session to %s', agenticDebugFile);
                }
            } else {
                // Fallback to simple completion if no context available
                logger.info('No context available - using direct completion (non-agentic)');
                
                const response = await reasoning.complete({
                    systemPrompt: `You are a transcript formatter. Convert the following raw transcript into clean, well-structured Markdown. 
Preserve ALL content - do not summarize. Only fix obvious formatting issues and organize into paragraphs.
If you see names that might be misspelled, keep them as-is since you don't have context to verify.`,
                    prompt: transcription.text,
                });
                
                markdownContent = response.content;
            }

            // Save the markdown version
            await storage.writeFile(markdownOutputPath, markdownContent, 'utf8');
            logger.info('Markdown transcription saved to: %s', markdownOutputPath);
        } else {
            logger.info('Markdown transcription file %s already exists, skipping...', markdownOutputPath);
        }

        return {
            ...transcription,
            audioFileBasename,
            toolsUsed,
            agentIterations,
        };
    }

    return {
        transcribe,
    }
} 