import { cook } from "@kjerneverk/riotprompt";
import type { Prompt } from "@kjerneverk/riotprompt";
import { DEFAULT_INSTRUCTIONS_TRANSCRIBE_FILE, DEFAULT_PERSONA_TRANSCRIBER_FILE } from '@/constants';
import { Config } from '@/types';
import { fileURLToPath } from "node:url";
import path from "node:path";
import { initializeTemplates, selectTemplate } from './templates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize templates once on module load
initializeTemplates();

// Re-export Prompt type for compatibility
export type { Prompt };

/**
 * Creates a prompt for the transcription formatting task.
 * 
 * Uses RiotPrompt's cook() API for declarative prompt construction with templates.
 * 
 * NOTE: Context is NOT loaded into the prompt. Instead, the agentic executor
 * provides tools for the model to query context on-demand. This is the 
 * agentic approach - the model investigates what it needs rather than
 * receiving everything upfront.
 * 
 * @param transcriptionText - The raw transcript text
 * @param _config - Protokoll configuration
 * @param options - Optional configuration for template selection
 * @returns Cooked prompt ready for the model
 */
export const createTranscribePrompt = async (
    transcriptionText: string,
    _config: Config,
    options?: {
        template?: string;
        autoSelectTemplate?: boolean;
        templateHints?: { 
            isMeeting?: boolean; 
            isTechnical?: boolean; 
            isQuick?: boolean;
            isInterview?: boolean;
        };
    }
): Promise<Prompt> => {
    // Determine which template to use
    let templateName: string | undefined;
    
    if (options?.template) {
        // Explicit template specified
        templateName = options.template;
    } else if (options?.autoSelectTemplate !== false) {
        // Auto-select template based on content (default behavior)
        templateName = selectTemplate(transcriptionText, options?.templateHints);
    }
    // If no template and autoSelect disabled, use file-based persona/instructions
    
    // Use cook() for declarative prompt construction
    const prompt = await cook({
        basePath: __dirname,
        
        // Use template if selected, otherwise fall back to file-based
        ...(templateName && { template: templateName }),
        
        // Load persona from file (only if not using template)
        ...(!templateName && {
            persona: {
                path: DEFAULT_PERSONA_TRANSCRIBER_FILE
            }
        }),
        
        // Load instructions from file
        instructions: [
            { path: DEFAULT_INSTRUCTIONS_TRANSCRIBE_FILE }
        ],
        
        // Add the transcript as content
        content: [
            { content: transcriptionText, title: 'Transcript' }
        ]
        
        // Context is NOT loaded here - it's queried via tools in agentic mode
        // This prevents sending huge context payloads with every request
    });
    
    return prompt;
};

/**
 * Factory interface for transcribe prompts
 */
export interface Factory {
    createTranscribePrompt: (transcriptionText: string) => Promise<Prompt>;
}

/**
 * Create a factory for transcribe prompts
 * 
 * @param _model - Model parameter (unused, preserved for API compatibility)
 * @param config - Protokoll configuration
 */
export const create = (_model: unknown, config: Config): Factory => {
    return {
        createTranscribePrompt: async (transcriptionText: string): Promise<Prompt> => {
            return createTranscribePrompt(transcriptionText, config);
        }
    };
}; 