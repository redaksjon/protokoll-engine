/**
 * Transcript Operations
 * 
 * Core business logic for transcript parsing, listing, editing, and combining.
 * PKL-only implementation - all transcripts are stored in PKL format.
 */

import * as fs from 'fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import * as Context from '@redaksjon/context';
import * as Routing from '../routing';
import { Project } from '@redaksjon/context';
import { findProjectResilient } from '../utils/entityFinder';
import { 
    PklTranscript, 
    listTranscripts as listTranscriptsFromStorage,
    type TranscriptMetadata as PklMetadata,
    type ListTranscriptsOptions as StorageListOptions,
} from '@redaksjon/protokoll-format';
import { ensurePklExtension } from './pkl-utils';

/**
 * Parsed transcript structure
 */
export interface ParsedTranscript {
    filePath: string;
    title?: string;
    metadata: TranscriptMetadata;
    content: string;
    rawText: string;
}

export interface TranscriptMetadata {
    date?: string;
    time?: string;
    project?: string;
    projectId?: string;
    destination?: string;
    confidence?: string;
    signals?: string[];
    reasoning?: string;
    tags?: string[];
    duration?: string;
}

/**
 * Check if input looks like a UUID (8+ hex chars)
 */
export function isUuidInput(input: string): boolean {
    return /^[a-f0-9]{8}/.test(input);
}

/**
 * Find transcript by UUID using glob scan
 * TODO: Replace with index-based lookup for better performance with large collections
 * 
 * @param uuid - Full UUID or 8-character prefix
 * @param searchDirectories - Directories to search in
 * @returns Absolute path to transcript file, or null if not found
 */
export async function findTranscriptByUuid(
    uuid: string,
    searchDirectories: string[]
): Promise<string | null> {
    const prefix = uuid.substring(0, 8); // Support both full UUID and prefix
    const pattern = `${prefix}-*.pkl`;
    
    for (const dir of searchDirectories) {
        const matches = await glob(pattern, { cwd: dir, absolute: true });
        if (matches.length > 0) {
            // Return first match - UUIDs should be unique
            return matches[0];
        }
    }
    
    return null;
}

/**
 * Parse a transcript file into its components
 * PKL-only implementation
 * 
 * @param filePathOrUuid - File path or UUID to parse
 * @param searchDirectories - Optional directories to search if UUID is provided
 */
export const parseTranscript = async (
    filePathOrUuid: string,
    searchDirectories?: string[]
): Promise<ParsedTranscript> => {
    let resolvedPath: string;
    
    // Check if input is a UUID
    if (isUuidInput(filePathOrUuid)) {
        if (!searchDirectories || searchDirectories.length === 0) {
            throw new Error('Search directories required for UUID lookup');
        }
        const foundPath = await findTranscriptByUuid(filePathOrUuid, searchDirectories);
        if (!foundPath) {
            throw new Error(`Transcript not found for UUID: ${filePathOrUuid}`);
        }
        resolvedPath = foundPath;
    } else {
        // Existing path-based logic
        resolvedPath = ensurePklExtension(filePathOrUuid);
    }
    
    const transcript = PklTranscript.open(resolvedPath, { readOnly: true });
    
    try {
        const pklMetadata = transcript.metadata;
        const content = transcript.content;
        
        const result: ParsedTranscript = {
            filePath: resolvedPath,
            title: pklMetadata.title,
            metadata: {
                date: pklMetadata.date instanceof Date 
                    ? pklMetadata.date.toISOString().split('T')[0] 
                    : undefined,
                time: pklMetadata.recordingTime,
                project: pklMetadata.project,
                projectId: pklMetadata.projectId,
                destination: pklMetadata.routing?.destination,
                confidence: pklMetadata.routing?.confidence?.toString(),
                signals: pklMetadata.routing?.signals,
                reasoning: pklMetadata.routing?.reasoning,
                tags: pklMetadata.tags,
                duration: pklMetadata.duration,
            },
            content,
            rawText: content, // For PKL files, content is the enhanced text
        };
        
        return result;
    } finally {
        transcript.close();
    }
};

/**
 * Extract the timestamp from a transcript filename
 */
export const extractTimestampFromFilename = (filePath: string): { day: number; hour: number; minute: number } | null => {
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const match = basename.match(/^(\d{1,2})-(\d{2})(\d{2})/);
    
    if (match) {
        return {
            day: parseInt(match[1], 10),
            hour: parseInt(match[2], 10),
            minute: parseInt(match[3], 10),
        };
    }
    
    return null;
};

/**
 * Slugify a title for use in filenames
 */
export const slugifyTitle = (title: string): string => {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
};

/**
 * Parse duration string to seconds
 */
const parseDuration = (duration: string): number => {
    const match = duration.match(/(\d+):(\d+)/);
    if (match) {
        const [, minutes, seconds] = match;
        return parseInt(minutes, 10) * 60 + parseInt(seconds, 10);
    }
    return 0;
};

/**
 * Format seconds as duration string
 */
const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Expand ~ in paths
 */
const expandPath = (p: string): string => {
    if (p.startsWith('~')) {
        return path.join(process.env.HOME || '', p.slice(1));
    }
    return p;
};

/**
 * Extract date from metadata
 */
const extractDateFromMetadata = (metadata: TranscriptMetadata, filePath: string): Date => {
    if (metadata.date) {
        return new Date(metadata.date);
    }
    const timestamp = extractTimestampFromFilename(filePath);
    if (timestamp) {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), timestamp.day, timestamp.hour, timestamp.minute);
    }
    return new Date();
};

/**
 * Build routing config from context and project
 */
const buildRoutingConfig = (
    context: Context.ContextInstance,
    _targetProject: Project
): Routing.RoutingConfig => {
    const config = context.getConfig();
    const defaultPath = expandPath((config.outputDirectory as string) || '~/notes');
    
    const resolveRoutingPath = (routingPath: string | undefined): string => {
        if (!routingPath) {
            return defaultPath;
        }
        const expanded = expandPath(routingPath);
        if (!expanded.startsWith('/') && !expanded.match(/^[A-Za-z]:/)) {
            return path.resolve(defaultPath, expanded);
        }
        return expanded;
    };

    return {
        default: {
            path: resolveRoutingPath(undefined),
            structure: 'month',
            filename_options: ['date', 'time', 'subject'],
        },
        projects: context.getAllProjects()
            .filter(p => p.active !== false)
            .map(p => ({
                projectId: p.id,
                destination: {
                    path: resolveRoutingPath(p.routing?.destination),
                    structure: p.routing?.structure || 'month',
                    filename_options: p.routing?.filename_options || ['date', 'time', 'subject'],
                },
                classification: p.classification,
                active: p.active,
            })),
        conflict_resolution: 'primary' as const,
    };
};

/**
 * Combine multiple transcripts into a single document
 * PKL-only implementation
 */
export const combineTranscripts = async (
    filePaths: string[],
    options: {
        projectId?: string;
        title?: string;
        dryRun?: boolean;
        verbose?: boolean;
        contextDirectory?: string;
        /** Explicit context directories (from protokoll-config.yaml) */
        contextDirectories?: string[];
    } = {}
): Promise<{ outputPath: string; content: string }> => {
    if (filePaths.length === 0) {
        throw new Error('No transcript files provided');
    }
    
    const transcripts: ParsedTranscript[] = [];
    for (const filePath of filePaths) {
        try {
            const parsed = await parseTranscript(filePath);
            transcripts.push(parsed);
        } catch (error) {
            throw new Error(`Failed to parse transcript: ${filePath} - ${error}`);
        }
    }
    
    transcripts.sort((a, b) => {
        const aName = path.basename(a.filePath);
        const bName = path.basename(b.filePath);
        return aName.localeCompare(bName);
    });
    
    const firstTranscript = transcripts[0];
    const baseMetadata = { ...firstTranscript.metadata };
    
    // Use explicit contextDirectories from options if provided (from protokoll-config.yaml)
    const context = await Context.create({
        startingDir: options.contextDirectory || path.dirname(firstTranscript.filePath),
        contextDirectories: options.contextDirectories,
    });
    let targetProject: Project | undefined;
    
    if (options.projectId) {
        targetProject = findProjectResilient(context, options.projectId);
        baseMetadata.project = targetProject.name;
        baseMetadata.projectId = targetProject.id;
        
        if (targetProject.routing?.destination) {
            const config = context.getConfig();
            const defaultPath = expandPath((config.outputDirectory as string) || '~/notes');
            const routingPath = expandPath(targetProject.routing.destination);
            const resolvedPath = !routingPath.startsWith('/') && !routingPath.match(/^[A-Za-z]:/)
                ? path.resolve(defaultPath, routingPath)
                : routingPath;
            baseMetadata.destination = resolvedPath;
        }
    }
    
    let totalSeconds = 0;
    let hasDuration = false;
    for (const t of transcripts) {
        if (t.metadata.duration) {
            hasDuration = true;
            totalSeconds += parseDuration(t.metadata.duration);
        }
    }
    if (hasDuration && totalSeconds > 0) {
        baseMetadata.duration = formatDuration(totalSeconds);
    }
    
    const allTags = new Set<string>();
    for (const t of transcripts) {
        if (t.metadata.tags) {
            for (const tag of t.metadata.tags) {
                allTags.add(tag);
            }
        }
    }
    if (allTags.size > 0) {
        baseMetadata.tags = Array.from(allTags).sort();
    }
    
    const combinedTitle = options.title 
        ? options.title
        : (firstTranscript.title 
            ? `${firstTranscript.title} (Combined)`
            : 'Combined Transcript');
    
    // Build combined content
    const contentParts: string[] = [];
    for (let i = 0; i < transcripts.length; i++) {
        const t = transcripts[i];
        const sectionTitle = t.title || `Part ${i + 1}`;
        const sourceFile = path.basename(t.filePath);
        
        contentParts.push(`## ${sectionTitle}`);
        contentParts.push(`*Source: ${sourceFile}*`);
        contentParts.push('');
        contentParts.push(t.content);
        contentParts.push('');
    }
    
    const combinedContent = contentParts.join('\n');
    
    // Determine output path
    let outputPath: string;
    
    if (targetProject?.routing?.destination) {
        const routingConfig = buildRoutingConfig(context, targetProject);
        const routing = Routing.create(routingConfig, context, undefined);
        
        const audioDate = extractDateFromMetadata(baseMetadata, firstTranscript.filePath);
        
        const routingContext: Routing.RoutingContext = {
            transcriptText: combinedContent,
            audioDate,
            sourceFile: firstTranscript.filePath,
        };
        
        const decision = routing.route(routingContext);
        outputPath = routing.buildOutputPath(decision, routingContext);
        // Ensure .pkl extension
        outputPath = outputPath.replace(/\.md$/, '.pkl');
    } else {
        const firstDir = path.dirname(firstTranscript.filePath);
        const timestamp = extractTimestampFromFilename(firstTranscript.filePath);
        
        const filenameSuffix = options.title 
            ? slugifyTitle(options.title)
            : 'combined';
        
        if (timestamp) {
            const day = timestamp.day.toString().padStart(2, '0');
            const hour = timestamp.hour.toString().padStart(2, '0');
            const minute = timestamp.minute.toString().padStart(2, '0');
            outputPath = path.join(firstDir, `${day}-${hour}${minute}-${filenameSuffix}.pkl`);
        } else {
            outputPath = path.join(firstDir, `${filenameSuffix}.pkl`);
        }
    }
    
    // Create the combined PKL transcript
    if (!options.dryRun) {
        const initialMetadata: PklMetadata = {
            id: '', // Will be auto-generated by PklTranscript.create()
            title: combinedTitle,
            date: baseMetadata.date ? new Date(baseMetadata.date) : undefined,
            recordingTime: baseMetadata.time,
            project: targetProject?.name || baseMetadata.project,
            projectId: targetProject?.id || baseMetadata.projectId,
            tags: baseMetadata.tags || [],
            duration: baseMetadata.duration,
            status: 'reviewed',
        };
        
        if (targetProject) {
            initialMetadata.entities = {
                people: [],
                projects: [{
                    id: targetProject.id,
                    name: targetProject.name,
                    type: 'project',
                }],
                terms: [],
                companies: [],
            };
        }
        
        const newTranscript = PklTranscript.create(outputPath, initialMetadata);
        try {
            newTranscript.updateContent(combinedContent);
        } finally {
            newTranscript.close();
        }
    }
    
    return { outputPath, content: combinedContent };
};

/**
 * Edit transcript metadata and content
 * PKL-only implementation
 */
export const editTranscript = async (
    filePath: string,
    options: {
        title?: string;
        projectId?: string;
        tagsToAdd?: string[];
        tagsToRemove?: string[];
        dryRun?: boolean;
        verbose?: boolean;
        contextDirectory?: string;
        /** Explicit context directories (from protokoll-config.yaml) */
        contextDirectories?: string[];
    }
): Promise<{ outputPath: string; content: string }> => {
    const pklPath = ensurePklExtension(filePath);
    const transcript = PklTranscript.open(pklPath, { readOnly: false });
    
    try {
        const pklMetadata = transcript.metadata;
        const content = transcript.content;
        
        // Use explicit contextDirectories from options if provided (from protokoll-config.yaml)
        const context = await Context.create({
            startingDir: options.contextDirectory || path.dirname(pklPath),
            contextDirectories: options.contextDirectories,
        });
        let targetProject: Project | undefined;
        
        if (options.projectId) {
            targetProject = findProjectResilient(context, options.projectId);
        }
        
        const newTitle = options.title || pklMetadata.title || 'Untitled';
        
        // Build updated metadata
        const updatedMetadata: Partial<PklMetadata> = {};
        
        if (options.title) {
            updatedMetadata.title = newTitle;
        }
        
        if (targetProject) {
            updatedMetadata.project = targetProject.name;
            updatedMetadata.projectId = targetProject.id;
            
            // Update entities with the project
            const existingEntities = pklMetadata.entities || { people: [], projects: [], terms: [], companies: [] };
            updatedMetadata.entities = {
                people: existingEntities.people || [],
                projects: [{
                    id: targetProject.id,
                    name: targetProject.name,
                    type: 'project',
                }],
                terms: existingEntities.terms || [],
                companies: existingEntities.companies || [],
            };
        }
        
        // Handle tag updates
        if (options.tagsToAdd || options.tagsToRemove) {
            const currentTags = new Set(pklMetadata.tags || []);
            
            if (options.tagsToRemove) {
                for (const tag of options.tagsToRemove) {
                    currentTags.delete(tag);
                }
            }
            
            if (options.tagsToAdd) {
                for (const tag of options.tagsToAdd) {
                    currentTags.add(tag);
                }
            }
            
            updatedMetadata.tags = Array.from(currentTags).sort();
        }
        
        // Determine output path
        let outputPath = pklPath;
        
        if (targetProject?.routing?.destination || options.title) {
            if (targetProject?.routing?.destination) {
                const routingConfig = buildRoutingConfig(context, targetProject);
                const routing = Routing.create(routingConfig, context, undefined);
                
                const audioDate = pklMetadata.date instanceof Date ? pklMetadata.date : new Date();
                
                const routingContext: Routing.RoutingContext = {
                    transcriptText: content,
                    audioDate,
                    sourceFile: pklPath,
                };
                
                const decision = routing.route(routingContext);
                
                if (options.title) {
                    const basePath = path.dirname(routing.buildOutputPath(decision, routingContext));
                    const timestamp = extractTimestampFromFilename(pklPath);
                    const sluggedTitle = slugifyTitle(options.title);
                    
                    if (timestamp) {
                        const day = timestamp.day.toString().padStart(2, '0');
                        const hour = timestamp.hour.toString().padStart(2, '0');
                        const minute = timestamp.minute.toString().padStart(2, '0');
                        outputPath = path.join(basePath, `${day}-${hour}${minute}-${sluggedTitle}.pkl`);
                    } else {
                        outputPath = path.join(basePath, `${sluggedTitle}.pkl`);
                    }
                } else {
                    outputPath = routing.buildOutputPath(decision, routingContext);
                    outputPath = outputPath.replace(/\.md$/, '.pkl');
                }
            } else if (options.title) {
                const dir = path.dirname(pklPath);
                const timestamp = extractTimestampFromFilename(pklPath);
                const sluggedTitle = slugifyTitle(options.title);
                
                if (timestamp) {
                    const day = timestamp.day.toString().padStart(2, '0');
                    const hour = timestamp.hour.toString().padStart(2, '0');
                    const minute = timestamp.minute.toString().padStart(2, '0');
                    outputPath = path.join(dir, `${day}-${hour}${minute}-${sluggedTitle}.pkl`);
                } else {
                    outputPath = path.join(dir, `${sluggedTitle}.pkl`);
                }
            }
        }
        
        // Apply updates
        if (!options.dryRun) {
            if (Object.keys(updatedMetadata).length > 0) {
                transcript.updateMetadata(updatedMetadata);
            }
            
            // If output path changed, we need to move the file
            if (outputPath !== pklPath) {
                // Close current transcript
                transcript.close();
                
                // Create directory if needed
                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                
                // Copy to new location
                await fs.copyFile(pklPath, outputPath);
                
                // Delete old file
                await fs.unlink(pklPath);
            }
        }
        
        return { outputPath, content };
    } finally {
        // Only close if not already closed (due to move operation)
        try {
            transcript.close();
        } catch {
            // Already closed
        }
    }
};

/**
 * Transcript list item
 */
export interface TranscriptListItem {
    path: string;
    filename: string;
    uuid: string; // UUID identifier for this transcript
    date: string;
    time?: string;
    title: string;
    hasRawTranscript: boolean;
    createdAt: Date;
    status?: import('@redaksjon/protokoll-format').TranscriptStatus;
    openTasksCount?: number;
    contentSize?: number;
    entities?: {
        people?: Array<{ id: string; name: string }>;
        projects?: Array<{ id: string; name: string }>;
        terms?: Array<{ id: string; name: string }>;
        companies?: Array<{ id: string; name: string }>;
    };
}

export interface ListTranscriptsOptions {
    directory: string;
    limit?: number;
    offset?: number;
    sortBy?: 'date' | 'filename' | 'title';
    startDate?: string;
    endDate?: string;
    search?: string;
    projectId?: string;
    /** Project name - used as fallback when projectId is also set (matches transcripts with project name but no projectId) */
    project?: string;
}

export interface ListTranscriptsResult {
    transcripts: TranscriptListItem[];
    total: number;
    hasMore: boolean;
    limit: number;
    offset: number;
}

/**
 * List transcripts with filtering and pagination
 * Uses the protokoll-format storage API
 */
export const listTranscripts = async (options: ListTranscriptsOptions): Promise<ListTranscriptsResult> => {
    const {
        directory,
        limit = 50,
        offset = 0,
        sortBy = 'date',
        startDate,
        endDate,
        search,
        projectId,
        project,
    } = options;
    
    // Use the storage API from protokoll-format
    // Pass projectId for UUID-based filtering; project (name) as fallback for transcripts without projectId
    const storageOptions: StorageListOptions = {
        directory,
        limit,
        offset,
        sortBy,
        search,
        projectId,
        project,
        startDate,
        endDate,
    };
    
    const result = await listTranscriptsFromStorage(storageOptions);
    
    // Convert storage result to operations result format
    const transcripts: TranscriptListItem[] = result.transcripts.map(item => {
        // Extract UUID from the transcript file
        let uuid = '';
        try {
            const transcript = PklTranscript.open(item.filePath, { readOnly: true });
            uuid = transcript.metadata.id;
            transcript.close();
        } catch {
            // If we can't open the file, leave uuid empty
            uuid = '';
        }
        
        return {
            path: item.filePath,
            filename: path.basename(item.filePath),
            uuid,
            date: item.date instanceof Date ? item.date.toISOString().split('T')[0] : '',
            time: undefined, // Not in storage result
            title: item.title,
            hasRawTranscript: false, // Not in storage result, would need to open file to check
            createdAt: item.date || new Date(),
            status: item.status,
            openTasksCount: undefined, // Not in storage result
            contentSize: item.contentPreview?.length,
            entities: item.project ? {
                projects: [{
                    id: item.project,
                    name: item.project,
                }],
            } : undefined,
        };
    });
    
    return {
        transcripts,
        total: result.total,
        hasMore: result.hasMore,
        limit,
        offset,
    };
};

/**
 * Validate status transitions for transcript lifecycle
 * 
 * Ensures status changes follow valid workflow:
 * - Upload workflow: uploaded → transcribing → initial → enhanced → reviewed → closed
 * - Error can occur at any point
 * - Error status allows retry (back to uploaded or transcribing)
 * 
 * @param from - Current status
 * @param to - Desired status
 * @returns true if transition is valid, false otherwise
 */
export function isValidStatusTransition(
    from: import('@redaksjon/protokoll-format').TranscriptStatus | undefined,
    to: import('@redaksjon/protokoll-format').TranscriptStatus
): boolean {
    // If no current status, any status is valid (initial creation)
    if (!from) {
        return true;
    }
    
    // Define valid transitions for each status
    const validTransitions: Record<
        import('@redaksjon/protokoll-format').TranscriptStatus,
        import('@redaksjon/protokoll-format').TranscriptStatus[]
    > = {
        'uploaded': ['transcribing', 'error'],
        'transcribing': ['initial', 'error'],
        'error': ['uploaded', 'transcribing'], // Allow retry
        'initial': ['enhanced', 'in_progress', 'error'],
        'enhanced': ['reviewed', 'in_progress', 'error'],
        'reviewed': ['closed', 'in_progress', 'error'],
        'in_progress': ['initial', 'enhanced', 'reviewed', 'closed', 'error'],
        'closed': ['archived', 'in_progress', 'error'],
        'archived': ['closed', 'error'], // Allow un-archiving
    };
    
    return validTransitions[from]?.includes(to) ?? false;
}
