/**
 * Routing System Types
 *
 * Uses Dreadcabinet's FilesystemStructure and FilenameOption types
 * for consistent directory/filename patterns.
 * 
 * Design Note: This module is designed to be self-contained and may be
 * extracted for use in other tools (kronologi, observasjon) in the future.
 */

// Re-use Dreadcabinet types
export type FilesystemStructure = 'none' | 'year' | 'month' | 'day';
export type FilenameOption = 'date' | 'time' | 'subject';

export interface RouteDestination {
    path: string;                           // Base destination path
    structure: FilesystemStructure;         // Dreadcabinet structure
    filename_options: FilenameOption[];     // Dreadcabinet filename options
    createDirectories?: boolean;
}

export interface ClassificationSignal {
    type: 'explicit_phrase' | 'associated_person' | 'associated_company' | 'topic' | 'context_type';
    value: string;
    weight: number;  // 0-1, how much this signal contributes
}

export interface ClassificationResult {
    projectId: string;
    confidence: number;           // 0-1
    signals: ClassificationSignal[];
    reasoning: string;            // Human-readable explanation
}

export interface ProjectClassification {
    context_type: 'work' | 'personal' | 'mixed';
    associated_people?: string[];
    associated_companies?: string[];
    topics?: string[];
    explicit_phrases?: string[];
}

export interface ProjectRoute {
    projectId: string;
    destination: RouteDestination;
    classification: ProjectClassification;
    priority?: number;
    active?: boolean;
    auto_tags?: string[];
}

export interface RoutingConfig {
    default: RouteDestination;
    projects: ProjectRoute[];
    conflict_resolution: 'ask' | 'primary' | 'all';
    priority_order?: string[];  // Context type priority: ['work', 'personal']
}

export interface RouteDecision {
    projectId: string | null;
    destination: RouteDestination;
    confidence: number;
    signals: ClassificationSignal[];
    reasoning: string;
    auto_tags?: string[];
    // For multi-match scenarios
    alternateMatches?: ClassificationResult[];
}

export interface RoutingContext {
    transcriptText: string;
    audioDate: Date;
    sourceFile: string;
    hash?: string;
    // Optional hints from earlier processing
    detectedPeople?: string[];
    detectedCompanies?: string[];
    // Optional override for subject in filename (used when LLM generates a better title)
    subjectOverride?: string;
}

