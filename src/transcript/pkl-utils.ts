/**
 * PKL Transcript Utilities
 * 
 * Simple utility functions for working with .pkl transcript files.
 * This replaces the dual-format format-adapter.ts with PKL-only operations.
 */

import * as path from 'node:path';
import * as fs from 'fs/promises';
import { PklTranscript, isUuidInput } from '@redaksjon/protokoll-format';

type PklMetadata = {
    date?: Date;
    recordingTime?: string;
    project?: string;
    projectId?: string;
    routing?: {
        destination?: string;
        confidence?: number;
    };
    tags?: string[];
    duration?: string;
    status?: string;
    tasks?: unknown[];
    entities?: unknown;
    history?: unknown;
    title?: string;
};

/**
 * Check if a file is a .pkl transcript
 */
export function isPklFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pkl';
}

/**
 * Get the glob pattern for finding transcript files (PKL only)
 */
export function getTranscriptGlobPattern(): string {
    return '**/*.pkl';
}

/**
 * Strip .pkl extension from a transcript path
 * Used for creating extension-agnostic identifiers
 */
export function stripTranscriptExtension(filePath: string): string {
    return filePath.replace(/\.pkl$/i, '');
}

/**
 * Ensure a path has .pkl extension
 */
export function ensurePklExtension(filePath: string): string {
    if (isPklFile(filePath)) {
        return filePath;
    }
    // Remove any .md extension if present, add .pkl
    return filePath.replace(/\.md$/i, '') + '.pkl';
}

/**
 * Check if a transcript file exists
 * 
 * If the path has .pkl extension, checks that file.
 * If no extension, adds .pkl and checks.
 */
export async function transcriptExists(basePath: string): Promise<{ exists: boolean; path: string | null }> {
    const pklPath = ensurePklExtension(basePath);
    
    try {
        await fs.access(pklPath);
        return { exists: true, path: pklPath };
    } catch {
        return { exists: false, path: null };
    }
}

/**
 * Enhanced transcript existence check supporting UUID
 * 
 * @param pathOrUuid - File path or UUID to check
 * @param searchDirectories - Optional directories to search if UUID is provided
 * @returns Existence info with path and UUID if found
 */
export async function transcriptExistsUuid(
    pathOrUuid: string,
    searchDirectories?: string[]
): Promise<{ exists: boolean; path?: string; uuid?: string }> {
    if (isUuidInput(pathOrUuid)) {
        if (!searchDirectories || searchDirectories.length === 0) {
            return { exists: false };
        }
        // Import dynamically to avoid circular dependency
        const { findTranscriptByUuid } = await import('./operations');
        const foundPath = await findTranscriptByUuid(pathOrUuid, searchDirectories);
        if (foundPath) {
            // Extract UUID from found file
            const transcript = PklTranscript.open(foundPath, { readOnly: true });
            const uuid = transcript.metadata.id;
            transcript.close();
            return { exists: true, path: foundPath, uuid };
        }
        return { exists: false };
    }
    
    // Fallback to existing transcriptExists logic
    const result = await transcriptExists(ensurePklExtension(pathOrUuid));
    return { exists: result.exists, path: result.path ?? undefined };
}

/**
 * Resolve a transcript identifier to an actual file path
 * 
 * @param identifier The transcript identifier (with or without extension)
 * @param baseDirectory Optional base directory to resolve relative paths
 * @returns The resolved file info
 */
export async function resolveTranscriptPath(
    identifier: string,
    baseDirectory?: string
): Promise<{ exists: boolean; path: string | null }> {
    let basePath = identifier;
    if (baseDirectory && !path.isAbsolute(identifier)) {
        basePath = path.resolve(baseDirectory, identifier);
    }
    
    return transcriptExists(basePath);
}

/**
 * Read transcript content from a .pkl file
 * Returns the content and metadata
 */
export async function readTranscriptContent(filePath: string): Promise<{
    content: string;
    mimeType: string;
    metadata: Record<string, unknown>;
    title?: string;
}> {
    const pklPath = ensurePklExtension(filePath);
    const transcript = PklTranscript.open(pklPath, { readOnly: true });
    
    try {
        const pklMetadata = transcript.metadata as PklMetadata;
        return {
            content: transcript.content,
            mimeType: 'text/plain',
            metadata: convertPklMetadataToLegacy(pklMetadata),
            title: pklMetadata.title,
        };
    } finally {
        transcript.close();
    }
}

/**
 * Convert PklTranscript metadata to a simpler format for legacy compatibility
 */
export function convertPklMetadataToLegacy(
    pklMetadata: PklMetadata
): Record<string, unknown> {
    return {
        date: pklMetadata.date instanceof Date 
            ? pklMetadata.date.toISOString().split('T')[0] 
            : undefined,
        time: pklMetadata.recordingTime,
        project: pklMetadata.project,
        projectId: pklMetadata.projectId,
        destination: pklMetadata.routing?.destination,
        confidence: pklMetadata.routing?.confidence?.toString(),
        tags: pklMetadata.tags,
        duration: pklMetadata.duration,
        status: pklMetadata.status,
        tasks: pklMetadata.tasks,
        entities: pklMetadata.entities,
        history: pklMetadata.history,
    };
}
