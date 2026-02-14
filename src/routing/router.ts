/**
 * Router
 * 
 * Handles routing decisions and path building using Dreadcabinet patterns.
 * Takes classification results and builds output paths with appropriate
 * directory structure and filenames.
 * 
 * Design Note: This module is designed to be self-contained and may be
 * extracted for use in other tools (kronologi, observasjon) in the future.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { 
    RoutingContext, 
    RouteDecision,
    RoutingConfig,
    FilesystemStructure
} from './types';
import * as Classifier from './classifier';

export interface RouterInstance {
    route(context: RoutingContext): RouteDecision;
    buildOutputPath(decision: RouteDecision, context: RoutingContext): string;
}

export const create = (
    config: RoutingConfig,
    classifier: Classifier.ClassifierInstance
): RouterInstance => {
  
    const route = (context: RoutingContext): RouteDecision => {
        const results = classifier.classify(context, config.projects);
    
        if (results.length === 0) {
            return {
                projectId: null,
                destination: config.default,
                confidence: 1.0,
                signals: [],
                reasoning: 'No project matches found, using default routing',
            };
        }
    
        const bestMatch = results[0];
        const matchedProject = config.projects.find(p => p.projectId === bestMatch.projectId)!;
    
        // Handle conflict resolution if multiple high-confidence matches
        const highConfidenceMatches = results.filter(r => r.confidence > 0.5);
    
        if (highConfidenceMatches.length > 1 && config.conflict_resolution !== 'primary') {
            // Return best with alternates noted
            return {
                projectId: bestMatch.projectId,
                destination: matchedProject.destination,
                confidence: bestMatch.confidence,
                signals: bestMatch.signals,
                reasoning: bestMatch.reasoning,
                auto_tags: matchedProject.auto_tags,
                alternateMatches: highConfidenceMatches.slice(1),
            };
        }
    
        return {
            projectId: bestMatch.projectId,
            destination: matchedProject.destination,
            confidence: bestMatch.confidence,
            signals: bestMatch.signals,
            reasoning: bestMatch.reasoning,
            auto_tags: matchedProject.auto_tags,
        };
    };
  
    const buildOutputPath = (decision: RouteDecision, context: RoutingContext): string => {
        const { destination } = decision;
    
        // Expand ~ to home directory
        const basePath = expandPath(destination.path);
    
        // Build directory structure using Dreadcabinet patterns
        const directoryPath = buildDirectoryPath(basePath, destination.structure, context.audioDate);
    
        // Build filename using Dreadcabinet patterns
        // Pass structure so filename doesn't repeat info already in path
        const filename = buildFilename(destination.filename_options, context, destination.structure);
    
        return path.join(directoryPath, filename + '.md');
    };
  
    return { route, buildOutputPath };
};

// Dreadcabinet-style directory building
function buildDirectoryPath(
    basePath: string, 
    structure: FilesystemStructure, 
    date: Date
): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString();
    const day = date.getDate().toString();
  
    switch (structure) {
        case 'none':
            return basePath;
        case 'year':
            return path.join(basePath, year);
        case 'month':
            return path.join(basePath, year, month);
        case 'day':
            return path.join(basePath, year, month, day);
    }
}

// Dreadcabinet-style filename building
// The date portion is adjusted based on what's already in the directory path
function buildFilename(
    options: Array<'date' | 'time' | 'subject'>,
    context: RoutingContext,
    structure: FilesystemStructure
): string {
    const parts: string[] = [];
    const date = context.audioDate;
    const pad = (n: number) => n.toString().padStart(2, '0');
  
    for (const option of options) {
        switch (option) {
            case 'date': {
                // Adjust date format based on directory structure
                // Don't repeat info already in the path
                const day = pad(date.getDate());
                const month = pad(date.getMonth() + 1);
                const year = date.getFullYear().toString().slice(2);
                
                switch (structure) {
                    case 'day':
                        // Path has year/month/day - no date needed in filename
                        break;
                    case 'month':
                        // Path has year/month - only day in filename
                        parts.push(day);
                        break;
                    case 'year':
                        // Path has year - month+day in filename
                        parts.push(`${month}-${day}`);
                        break;
                    case 'none':
                        // No date in path - full date in filename (YYMMDD)
                        parts.push(`${year}${month}${day}`);
                        break;
                }
                break;
            }
            case 'time': {
                const hours = pad(date.getHours());
                const minutes = pad(date.getMinutes());
                parts.push(`${hours}${minutes}`);
                break;
            }
            case 'subject': {
                const subject = extractSubject(context.transcriptText, context.sourceFile, context.subjectOverride);
                if (subject) {
                    parts.push(subject);
                }
                break;
            }
        }
    }
  
    // Join and clean up any double dashes
    return parts.join('-').replace(/--+/g, '-');
}

function extractSubject(text: string, sourceFile: string, subjectOverride?: string): string {
    // Use override if provided (e.g., LLM-generated title)
    if (subjectOverride && subjectOverride.length > 0) {
        return slugify(subjectOverride);
    }
    
    // Try to extract from first sentence
    const firstSentence = text.split(/[.!?]/)[0]?.trim() ?? '';
  
    // Remove common prefixes
    const cleaned = firstSentence
        .replace(/^(this is a note about|note about|regarding|re:|meeting notes?:?)/i, '')
        .trim();
  
    if (cleaned.length > 3 && cleaned.length < 50) {
        return slugify(cleaned);
    }
  
    // Fall back to source filename
    return path.basename(sourceFile, path.extname(sourceFile))
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .toLowerCase();
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with dash
        .replace(/--+/g, '-')          // Collapse multiple dashes
        .replace(/^-|-$/g, '')         // Remove leading/trailing dashes
        .slice(0, 40);
}

function expandPath(p: string): string {
    if (p.startsWith('~')) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}

