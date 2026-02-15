import { OpenAI } from 'openai';
import { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import * as Storage from '@/util/storage';
import { getLogger } from '@/logging';
import { DEFAULT_MODEL, DEFAULT_TRANSCRIPTION_MODEL } from '@/constants';

export interface Transcription {
    text: string;
}

export class OpenAIError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OpenAIError';
    }
}


export async function createCompletion(messages: ChatCompletionMessageParam[], options: { responseFormat?: any, model?: string, reasoningLevel?: 'none' | 'low' | 'medium' | 'high', maxTokens?: number, debug?: boolean, debugFile?: string, reason?: string } = {}): Promise<string | any> {
    const logger = getLogger();
    const storage = Storage.create({ log: logger.debug });
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new OpenAIError('OPENAI_API_KEY environment variable is not set');
        }

        const openai = new OpenAI({
            apiKey: apiKey,
        });

        const model = options.model || DEFAULT_MODEL;
        
        // Check if model supports reasoning_effort
        const supportsReasoning = model.includes('gpt-5') || 
                                  model.includes('o1') || model.includes('o3');
        const isReasoningCall = supportsReasoning && options.reasoningLevel && options.reasoningLevel !== 'none';
        
        logger.debug('Sending prompt to OpenAI: %j', messages);

        const startTime = Date.now();
        
        const requestParams: Record<string, unknown> = {
            model,
            messages,
            max_completion_tokens: options.maxTokens || 10000,
            response_format: options.responseFormat,
        };
        
        if (isReasoningCall) {
            requestParams.reasoning_effort = options.reasoningLevel;
            logger.debug('Using reasoning_effort: %s', options.reasoningLevel);
        }
        
        const completion = await openai.chat.completions.create(
            requestParams as unknown as ChatCompletionCreateParamsNonStreaming
        );
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Log token usage with reason if provided
        const usage = completion.usage;
        const reasonSuffix = options.reason ? ` - ${options.reason}` : '';
        if (usage) {
            logger.info('%s (%ss, %d→%d tokens)%s', 
                model, duration, usage.prompt_tokens, usage.completion_tokens, reasonSuffix);
        } else {
            logger.info('%s (%ss)%s', model, duration, reasonSuffix);
        }

        if (options.debug && options.debugFile) {
            await storage.writeFile(options.debugFile, JSON.stringify(completion, null, 2), 'utf8');
            logger.debug('Wrote debug file to %s', options.debugFile);
        }

        const response = completion.choices[0]?.message?.content?.trim();
        if (!response) {
            // Log the full completion object to help debug
            logger.error('Empty response from OpenAI. Full completion object: %j', completion);
            throw new OpenAIError('No response received from OpenAI');
        }

        logger.debug('Received response from OpenAI: %s', response);
        if (options.responseFormat) {
            return JSON.parse(response);
        } else {
            return response;
        }

    } catch (error: any) {
        logger.error('Error calling OpenAI API: %s %s', error.message, error.stack);
        throw new OpenAIError(`Failed to create completion: ${error.message}`);
    }
}

export async function transcribeAudio(filePath: string, options: { model?: string, debug?: boolean, debugFile?: string } = {}): Promise<Transcription> {
    const logger = getLogger();
    const storage = Storage.create({ log: logger.debug });
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new OpenAIError('OPENAI_API_KEY environment variable is not set');
        }

        const openai = new OpenAI({
            apiKey: apiKey,
        });

        const model = options.model || DEFAULT_TRANSCRIPTION_MODEL;
        const fileName = filePath.split('/').pop() || filePath;
        logger.debug('Transcribing: %s (full path: %s)', fileName, filePath);

        const startTime = Date.now();
        const audioStream = await storage.readStream(filePath);
        const transcription = await openai.audio.transcriptions.create({
            model,
            file: audioStream,
            response_format: "json",
        });
        
        if (!transcription) {
            throw new OpenAIError('No transcription received from OpenAI');
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info('%s (%ss, %d chars)', model, duration, transcription.text?.length || 0);

        if (options.debug && options.debugFile) {
            await storage.writeFile(options.debugFile, JSON.stringify(transcription, null, 2), 'utf8');
            logger.debug('Wrote debug file to %s', options.debugFile);
        }

        logger.debug('Received transcription from OpenAI: %s', transcription);
        return transcription;

    } catch (error: any) {
        logger.error('Error transcribing audio file: %s %s', error.message, error.stack);
        throw new OpenAIError(`Failed to transcribe audio: ${error.message}`);
    }
}
