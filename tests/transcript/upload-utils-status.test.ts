import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PklTranscript } from '@redaksjon/protokoll-format';
import {
    findUploadedTranscripts,
    findTranscribingTranscripts,
    resetTranscriptToUploaded,
} from '../../src/transcript/upload-utils';

describe('upload utils status behavior with deleted transcripts', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protokoll-upload-status-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function createTranscript(
        filename: string,
        status: 'uploaded' | 'transcribing' | 'deleted'
    ): Promise<string> {
        const filePath = path.join(tempDir, filename);
        const transcript = PklTranscript.create(filePath, {
            id: '12345678-aaaa-bbbb-cccc-1234567890ab',
            status,
            date: new Date('2026-03-04T10:00:00.000Z'),
        });
        try {
            transcript.updateContent('content');
        } finally {
            await transcript.close();
        }
        return filePath;
    }

    it('does not include deleted transcripts in uploaded queue scan', async () => {
        await createTranscript('12345678-uploaded.pkl', 'uploaded');
        await createTranscript('87654321-deleted.pkl', 'deleted');

        const queued = await findUploadedTranscripts([tempDir]);
        expect(queued).toHaveLength(1);
        expect(queued[0].metadata.status).toBe('uploaded');
    });

    it('does not include deleted transcripts in transcribing recovery scan', async () => {
        await createTranscript('12345678-transcribing.pkl', 'transcribing');
        await createTranscript('87654321-deleted.pkl', 'deleted');

        const transcribing = await findTranscribingTranscripts([tempDir]);
        expect(transcribing).toHaveLength(1);
        expect(transcribing[0].metadata.status).toBe('transcribing');
    });

    it('does not reset deleted transcripts back to uploaded', async () => {
        const deletedPath = await createTranscript('12345678-deleted.pkl', 'deleted');
        await resetTranscriptToUploaded(deletedPath);

        const transcript = PklTranscript.open(deletedPath, { readOnly: true });
        try {
            expect(transcript.metadata.status).toBe('deleted');
        } finally {
            await transcript.close();
        }
    });
});
