/**
 * Transcription Prompt Templates
 * 
 * Reusable templates for different transcription scenarios.
 * Uses RiotPrompt's template system for consistent prompt structure.
 */

import { registerTemplates, getTemplates, clearTemplates } from '@kjerneverk/riotprompt';
import type { TemplateConfig } from '@kjerneverk/riotprompt';

/**
 * Available transcription templates
 */
export const TEMPLATES: Record<string, TemplateConfig> = {
    // Standard transcription template (default)
    'transcription-standard': {
        persona: { 
            content: 'You are an expert transcription assistant specializing in correcting misheard names and technical terms while preserving all original content.'
        },
        constraints: [
            { content: 'Preserve ALL original content - this is NOT a summary.' },
            { content: 'Only correct obvious transcription errors (misheard names, technical terms).' },
            { content: 'Maintain the original structure, flow, and speaking style.' },
            { content: 'Never add information that was not in the original transcript.' }
        ],
        tone: [
            { content: 'Professional and accurate.' },
            { content: 'When uncertain about a correction, preserve the original text.' }
        ]
    },
    
    // Meeting notes template
    'transcription-meeting': {
        persona: { 
            content: 'You are an expert transcription assistant specializing in meeting notes and discussions.'
        },
        constraints: [
            { content: 'Preserve ALL discussion points, decisions, and action items.' },
            { content: 'Correct names of participants and companies.' },
            { content: 'Maintain the chronological flow of the discussion.' },
            { content: 'Format action items and decisions clearly.' }
        ],
        tone: [
            { content: 'Professional and organized.' },
            { content: 'Clear and structured for easy reference.' }
        ]
    },
    
    // Technical discussion template
    'transcription-technical': {
        persona: { 
            content: 'You are an expert transcription assistant with deep technical knowledge across software, engineering, and technology domains.'
        },
        constraints: [
            { content: 'Preserve technical details and specifications accurately.' },
            { content: 'Correct technical term spellings (APIs, frameworks, tools, protocols).' },
            { content: 'Maintain code snippets, commands, and technical references exactly.' },
            { content: 'Preserve technical jargon and domain-specific terminology.' }
        ],
        tone: [
            { content: 'Precise and technically accurate.' },
            { content: 'Maintain the technical depth of the original discussion.' }
        ]
    },
    
    // Quick notes template (brief voice memos)
    'transcription-quick': {
        persona: { 
            content: 'You are a transcription assistant for quick voice notes and brief memos.'
        },
        constraints: [
            { content: 'Keep the original brevity and directness.' },
            { content: 'Focus on capturing key information clearly.' },
            { content: 'Correct obvious errors but maintain the informal style.' }
        ],
        tone: [
            { content: 'Concise and direct.' },
            { content: 'Preserve the informal, note-taking style.' }
        ]
    },
    
    // Interview template
    'transcription-interview': {
        persona: {
            content: 'You are an expert transcription assistant specializing in interviews and conversations.'
        },
        constraints: [
            { content: 'Preserve ALL questions and answers completely.' },
            { content: 'Maintain speaker attribution and conversational flow.' },
            { content: 'Correct names and proper nouns mentioned.' },
            { content: 'Keep the natural speaking patterns and emphasis.' }
        ],
        tone: [
            { content: 'Accurate and respectful of the speakers\' voices.' },
            { content: 'Clear speaker identification throughout.' }
        ]
    }
};

/**
 * Initialize templates by registering them with RiotPrompt
 * Should be called once at application startup
 */
export const initializeTemplates = (): void => {
    registerTemplates(TEMPLATES);
};

/**
 * Get list of available template names
 */
export const getTemplateNames = (): string[] => {
    return Object.keys(getTemplates());
};

/**
 * Clear all registered templates
 * Useful for testing or reinitialization
 */
export const clearAllTemplates = (): void => {
    clearTemplates();
};

/**
 * Auto-select appropriate template based on transcript content
 * 
 * @param transcriptText - The transcript text to analyze
 * @param hints - Optional hints about the transcript type
 * @returns Template name to use
 */
export const selectTemplate = (
    transcriptText: string,
    hints?: { 
        isMeeting?: boolean; 
        isTechnical?: boolean; 
        isQuick?: boolean;
        isInterview?: boolean;
    }
): string => {
    // Check explicit hints first
    if (hints?.isMeeting) return 'transcription-meeting';
    if (hints?.isTechnical) return 'transcription-technical';
    if (hints?.isQuick) return 'transcription-quick';
    if (hints?.isInterview) return 'transcription-interview';
    
    // Auto-detect from content
    const lowerText = transcriptText.toLowerCase();
    
    // Meeting indicators
    if (lowerText.includes('meeting') || 
        lowerText.includes('agenda') || 
        lowerText.includes('action item') ||
        lowerText.includes('minutes') ||
        lowerText.includes('attendees')) {
        return 'transcription-meeting';
    }
    
    // Interview indicators (check before length-based quick detection)
    if ((lowerText.match(/\binterviewer\b/g) || []).length > 1 ||
        (lowerText.match(/\binterviewee\b/g) || []).length > 1 ||
        (lowerText.match(/\bq:|question:/gi) || []).length > 2 ||
        (lowerText.match(/\ba:|answer:/gi) || []).length > 2) {
        return 'transcription-interview';
    }
    
    // Technical indicators
    if (lowerText.includes('code') || 
        lowerText.includes('function') || 
        lowerText.includes('api') ||
        lowerText.includes('database') ||
        lowerText.includes('server') ||
        lowerText.includes('algorithm') ||
        /\b(npm|git|docker|kubernetes|react|python|javascript|typescript)\b/i.test(transcriptText)) {
        return 'transcription-technical';
    }
    
    // Quick note indicators (short length) - check last to avoid false positives
    // Use a more conservative threshold to avoid misclassifying short but substantial content
    if (transcriptText.length < 300) {
        return 'transcription-quick';
    }
    
    // Default to standard
    return 'transcription-standard';
};

/**
 * Get template configuration by name
 * 
 * @param name - Template name
 * @returns Template configuration or undefined if not found
 */
export const getTemplate = (name: string): TemplateConfig | undefined => {
    const templates = getTemplates();
    return templates[name];
};
