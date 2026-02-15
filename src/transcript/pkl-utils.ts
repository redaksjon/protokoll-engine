/**
 * PKL Transcript Utilities
 * 
 * Simple utility functions for working with .pkl transcript files.
 * This replaces the dual-format format-adapter.ts with PKL-only operations.
 */

import * as path from 'node:path';
import * as fs from 'fs/promises';
import { PklTranscript } from '@redaksjon/protokoll-format';
import type { TranscriptMetadata as PklMetadata } from '@redaksjon/protokoll-format';

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
        const pklMetadata = transcript.metadata;
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
