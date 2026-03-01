/**
 * Upload workflow utilities for audio transcription
 * 
 * Handles creation of transcript records for uploaded audio files
 * and queue scanning for files awaiting transcription.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { glob } from 'glob';
import { PklTranscript } from '@redaksjon/protokoll-format';

type TranscriptMetadata = {
    id: string;
    status: 'uploaded' | 'transcribing' | 'error' | 'initial' | 'enhanced' | 'reviewed' | 'in_progress' | 'closed' | 'archived';
    audioFile?: string;
    audioHash?: string;
    date?: Date;
    title?: string;
    project?: string;
    errorDetails?: string;
};

/**
 * Parameters for creating an upload transcript
 */
export interface CreateUploadTranscriptParams {
  audioFile: string;          // Path to uploaded audio file
  originalFilename: string;   // Original uploaded filename
  audioHash: string;          // File hash for deduplication
  outputDirectory: string;    // Where to create PKL
  title?: string;             // Optional title hint
  project?: string;           // Optional project hint
}

/**
 * Generate a UUID-prefixed filename
 * Format: {8-char-uuid}-{basename}.pkl
 */
export function generateFilenameWithUuid(uuid: string, basename: string): string {
    // Take first 8 characters of UUID
    const prefix = uuid.substring(0, 8);
    // Remove .pkl extension from basename if present
    const base = basename.replace(/\.pkl$/, '');
    return `${prefix}-${base}.pkl`;
}

/**
 * Format timestamp for filename
 */
function formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

/**
 * Create a transcript record for an uploaded audio file
 * 
 * Creates a PKL file with 'uploaded' status and UUID-prefixed filename.
 * This makes the transcript discoverable via findTranscriptByUuid().
 * 
 * @param params - Upload transcript parameters
 * @returns UUID and file path of created transcript
 */
export async function createUploadTranscript(
    params: CreateUploadTranscriptParams
): Promise<{ uuid: string; filePath: string }> {
    const uuid = randomUUID();
    const timestamp = formatTimestamp(new Date());
  
    // Use UUID-prefixed filename for uploads
    const filename = generateFilenameWithUuid(uuid, `${timestamp}-upload.pkl`);
    const filePath = join(params.outputDirectory, filename);
  
    const metadata: TranscriptMetadata = {
        id: uuid,
        status: 'uploaded',
        audioFile: params.audioFile,  // Actual filename on disk (e.g. hash.ext) for worker to locate file
        audioHash: params.audioHash,
        date: new Date(),
        title: params.title,
        project: params.project,
    };
  
    const transcript = PklTranscript.create(filePath, metadata);
    await transcript.close();
  
    return { uuid, filePath };
}

/**
 * Result from scanning for uploaded transcripts
 */
export interface UploadedTranscript {
  uuid: string;
  filePath: string;
  metadata: TranscriptMetadata;
}

/**
 * Find all transcripts in 'uploaded' status ready for transcription
 * 
 * Scans directories for PKL files with UUID prefixes and 'uploaded' status.
 * Results are sorted by date (oldest first) for FIFO processing.
 * 
 * @param searchDirectories - Directories to scan for transcripts
 * @returns Array of uploaded transcripts sorted by date
 */
export async function findUploadedTranscripts(
    searchDirectories: string[]
): Promise<UploadedTranscript[]> {
    const results: UploadedTranscript[] = [];
  
    for (const dir of searchDirectories) {
    // Find all PKL files with UUID prefixes (8 hex chars followed by dash)
        const files = await glob('????????-*.pkl', { cwd: dir, absolute: true });
    
        for (const file of files) {
            try {
                const transcript = PklTranscript.open(file, { readOnly: true });
                const metadata = transcript.metadata as TranscriptMetadata;
                
                if (metadata.status === 'uploaded') {
                    results.push({ 
                        uuid: metadata.id, 
                        filePath: file, 
                        metadata 
                    });
                }
                
                await transcript.close();
            } catch (error) {
                // Skip files that can't be opened (corrupted, locked, etc.)
                // eslint-disable-next-line no-console
                console.warn(`Failed to open transcript ${file}:`, error);
            }
        }
    }
  
    // Sort by date (oldest first) for FIFO processing
    return results.sort((a, b) => {
        const aTime = a.metadata.date?.getTime() || 0;
        const bTime = b.metadata.date?.getTime() || 0;
        return aTime - bTime;
    });
}

/**
 * Find transcripts in 'transcribing' status (for recovery after crash)
 * 
 * These transcripts were being processed when the server stopped.
 * They should be reset to 'uploaded' and re-queued.
 * 
 * @param searchDirectories - Directories to scan for transcripts
 * @returns Array of transcribing transcripts
 */
export async function findTranscribingTranscripts(
    searchDirectories: string[]
): Promise<UploadedTranscript[]> {
    const results: UploadedTranscript[] = [];
  
    for (const dir of searchDirectories) {
        const files = await glob('????????-*.pkl', { cwd: dir, absolute: true });
    
        for (const file of files) {
            try {
                const transcript = PklTranscript.open(file, { readOnly: true });
                const metadata = transcript.metadata as TranscriptMetadata;
                
                if (metadata.status === 'transcribing') {
                    results.push({ 
                        uuid: metadata.id, 
                        filePath: file, 
                        metadata 
                    });
                }
                
                await transcript.close();
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn(`Failed to open transcript ${file}:`, error);
            }
        }
    }
  
    return results;
}

/**
 * Reset a transcript from 'transcribing' or 'error' to 'uploaded' for retry
 * 
 * Used during queue recovery on server startup or manual retry.
 * 
 * @param filePath - Path to transcript file
 */
export async function resetTranscriptToUploaded(filePath: string): Promise<void> {
    const transcript = PklTranscript.open(filePath);
    const metadata = transcript.metadata as TranscriptMetadata;
    
    if (metadata.status === 'transcribing' || metadata.status === 'error') {
        transcript.updateMetadata({ 
            status: 'uploaded',
            errorDetails: undefined, // Clear error details on retry
        });
        await transcript.close();
    } else {
        await transcript.close();
    }
}

/**
 * Mark a transcript as transcribing (in progress)
 * 
 * @param filePath - Path to transcript file
 */
export async function markTranscriptAsTranscribing(filePath: string): Promise<void> {
    const transcript = PklTranscript.open(filePath);
    transcript.updateMetadata({ status: 'transcribing' });
    await transcript.close();
}

/**
 * Mark a transcript as failed with error details
 * 
 * @param filePath - Path to transcript file
 * @param errorDetails - Error message/details
 */
export async function markTranscriptAsFailed(
    filePath: string, 
    errorDetails: string
): Promise<void> {
    const transcript = PklTranscript.open(filePath);
    transcript.updateMetadata({ 
        status: 'error',
        errorDetails 
    });
    await transcript.close();
}
