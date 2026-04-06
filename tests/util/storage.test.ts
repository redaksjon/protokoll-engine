/**
 * Tests for Storage Utility
 * 
 * Tests the filesystem abstraction layer using real temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { create } from '../../src/util/storage';

describe('Storage Utility', () => {
    let storage: ReturnType<typeof create>;
    let tempDir: string;
    let logMessages: string[];

    beforeEach(async () => {
        logMessages = [];
        storage = create({
            log: (msg: string, ...args: any[]) => {
                logMessages.push(msg + ' ' + args.join(' '));
            },
        });
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('exists', () => {
        it('should return true for an existing file', async () => {
            const filePath = path.join(tempDir, 'existing.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.exists(filePath)).toBe(true);
        });

        it('should return true for an existing directory', async () => {
            expect(await storage.exists(tempDir)).toBe(true);
        });

        it('should return false for a non-existing path', async () => {
            expect(await storage.exists(path.join(tempDir, 'nonexistent'))).toBe(false);
        });
    });

    describe('isDirectory', () => {
        it('should return true for a directory', async () => {
            expect(await storage.isDirectory(tempDir)).toBe(true);
        });

        it('should return false for a file', async () => {
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isDirectory(filePath)).toBe(false);
        });

        it('should log when path is not a directory', async () => {
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            await storage.isDirectory(filePath);
            expect(logMessages.some(m => m.includes('is not a directory'))).toBe(true);
        });

        it('should throw for non-existing path', async () => {
            await expect(storage.isDirectory(path.join(tempDir, 'nope'))).rejects.toThrow();
        });
    });

    describe('isFile', () => {
        it('should return true for a file', async () => {
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isFile(filePath)).toBe(true);
        });

        it('should return false for a directory', async () => {
            expect(await storage.isFile(tempDir)).toBe(false);
        });

        it('should log when path is not a file', async () => {
            await storage.isFile(tempDir);
            expect(logMessages.some(m => m.includes('is not a file'))).toBe(true);
        });

        it('should throw for non-existing path', async () => {
            await expect(storage.isFile(path.join(tempDir, 'nope'))).rejects.toThrow();
        });
    });

    describe('isReadable', () => {
        it('should return true for a readable file', async () => {
            const filePath = path.join(tempDir, 'readable.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isReadable(filePath)).toBe(true);
        });

        it('should return true for a readable directory', async () => {
            expect(await storage.isReadable(tempDir)).toBe(true);
        });

        it('should return false for a non-readable path', async () => {
            // Skip when running as root (root bypasses permission checks)
            if (process.getuid?.() === 0) return;
            // Create a file and remove read permissions
            const filePath = path.join(tempDir, 'noread.txt');
            await fs.writeFile(filePath, 'hello');
            try {
                await fs.chmod(filePath, 0o000);
                expect(await storage.isReadable(filePath)).toBe(false);
            } finally {
                await fs.chmod(filePath, 0o644);
            }
        });

        it('should return false for non-existing path', async () => {
            expect(await storage.isReadable(path.join(tempDir, 'nope'))).toBe(false);
        });

        it('should log when path is not readable', async () => {
            // Skip when running as root (root bypasses permission checks)
            if (process.getuid?.() === 0) return;
            const filePath = path.join(tempDir, 'noread.txt');
            await fs.writeFile(filePath, 'hello');
            try {
                await fs.chmod(filePath, 0o000);
                await storage.isReadable(filePath);
                expect(logMessages.some(m => m.includes('is not readable'))).toBe(true);
            } finally {
                await fs.chmod(filePath, 0o644);
            }
        });
    });

    describe('isWritable', () => {
        it('should return true for a writable file', async () => {
            const filePath = path.join(tempDir, 'writable.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isWritable(filePath)).toBe(true);
        });

        it('should return true for a writable directory', async () => {
            expect(await storage.isWritable(tempDir)).toBe(true);
        });

        it('should return false for a non-writable path', async () => {
            // Skip when running as root (root bypasses permission checks)
            if (process.getuid?.() === 0) return;
            const filePath = path.join(tempDir, 'nowrite.txt');
            await fs.writeFile(filePath, 'hello');
            try {
                await fs.chmod(filePath, 0o444);
                expect(await storage.isWritable(filePath)).toBe(false);
            } finally {
                await fs.chmod(filePath, 0o644);
            }
        });

        it('should return false for non-existing path', async () => {
            expect(await storage.isWritable(path.join(tempDir, 'nope'))).toBe(false);
        });

        it('should log when path is not writable', async () => {
            // Skip when running as root (root bypasses permission checks)
            if (process.getuid?.() === 0) return;
            const filePath = path.join(tempDir, 'nowrite.txt');
            await fs.writeFile(filePath, 'hello');
            try {
                await fs.chmod(filePath, 0o444);
                await storage.isWritable(filePath);
                expect(logMessages.some(m => m.includes('is not writable'))).toBe(true);
            } finally {
                await fs.chmod(filePath, 0o644);
            }
        });
    });

    describe('isFileReadable', () => {
        it('should return true for a readable file', async () => {
            const filePath = path.join(tempDir, 'readable.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isFileReadable(filePath)).toBe(true);
        });

        it('should return false for a directory', async () => {
            expect(await storage.isFileReadable(tempDir)).toBe(false);
        });

        it('should return false for non-existing path', async () => {
            expect(await storage.isFileReadable(path.join(tempDir, 'nope'))).toBe(false);
        });
    });

    describe('isDirectoryWritable', () => {
        it('should return true for a writable directory', async () => {
            expect(await storage.isDirectoryWritable(tempDir)).toBe(true);
        });

        it('should return false for a file', async () => {
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isDirectoryWritable(filePath)).toBe(false);
        });

        it('should return false for non-existing path', async () => {
            expect(await storage.isDirectoryWritable(path.join(tempDir, 'nope'))).toBe(false);
        });
    });

    describe('isDirectoryReadable', () => {
        it('should return true for a readable directory', async () => {
            expect(await storage.isDirectoryReadable(tempDir)).toBe(true);
        });

        it('should return false for a file', async () => {
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            expect(await storage.isDirectoryReadable(filePath)).toBe(false);
        });

        it('should return false for non-existing path', async () => {
            expect(await storage.isDirectoryReadable(path.join(tempDir, 'nope'))).toBe(false);
        });
    });

    describe('createDirectory', () => {
        it('should create a new directory', async () => {
            const newDir = path.join(tempDir, 'new', 'nested', 'dir');
            await storage.createDirectory(newDir);
            expect(await fs.stat(newDir)).toBeDefined();
            expect((await fs.stat(newDir)).isDirectory()).toBe(true);
        });

        it('should not throw for an existing directory', async () => {
            await expect(storage.createDirectory(tempDir)).resolves.not.toThrow();
        });

        it('should throw with descriptive message on failure', async () => {
            // Try to create a directory inside a file path (will fail)
            const filePath = path.join(tempDir, 'file.txt');
            await fs.writeFile(filePath, 'hello');
            await expect(storage.createDirectory(path.join(filePath, 'subdir'))).rejects.toThrow(
                /Failed to create output directory/
            );
        });
    });

    describe('readFile', () => {
        it('should read file contents as string', async () => {
            const filePath = path.join(tempDir, 'read.txt');
            await fs.writeFile(filePath, 'hello world', 'utf8');
            const content = await storage.readFile(filePath, 'utf8');
            expect(content).toBe('hello world');
        });

        it('should throw for non-existing file', async () => {
            await expect(storage.readFile(path.join(tempDir, 'nope'), 'utf8')).rejects.toThrow();
        });
    });

    describe('writeFile', () => {
        it('should write string content to a file', async () => {
            const filePath = path.join(tempDir, 'write.txt');
            await storage.writeFile(filePath, 'test content', 'utf8');
            const content = await fs.readFile(filePath, 'utf8');
            expect(content).toBe('test content');
        });

        it('should write Buffer content to a file', async () => {
            const filePath = path.join(tempDir, 'buffer.bin');
            const buf = Buffer.from([0x01, 0x02, 0x03]);
            await storage.writeFile(filePath, buf, 'binary');
            const content = await fs.readFile(filePath);
            expect(content).toEqual(buf);
        });
    });

    describe('forEachFileIn', () => {
        it('should iterate over files matching a pattern', async () => {
            await fs.writeFile(path.join(tempDir, 'a.txt'), 'a');
            await fs.writeFile(path.join(tempDir, 'b.txt'), 'b');
            await fs.mkdir(path.join(tempDir, 'subdir'));

            const files: string[] = [];
            await storage.forEachFileIn(tempDir, async (f) => {
                files.push(f);
            }, { pattern: '*.txt' });

            expect(files).toHaveLength(2);
            expect(files.sort()).toEqual([
                path.join(tempDir, 'a.txt'),
                path.join(tempDir, 'b.txt'),
            ]);
        });

        it('should iterate with default pattern', async () => {
            await fs.writeFile(path.join(tempDir, 'a.txt'), 'a');
            await fs.writeFile(path.join(tempDir, 'b.md'), 'b');

            const files: string[] = [];
            await storage.forEachFileIn(tempDir, async (f) => {
                files.push(f);
            });

            expect(files).toHaveLength(2);
        });

        it('should handle nonexistent directory gracefully', async () => {
            const files: string[] = [];
            await storage.forEachFileIn('/nonexistent/path/that/does/not/exist', async (f) => {
                files.push(f);
            });
            // glob returns empty array for nonexistent paths, doesn't throw
            expect(files).toHaveLength(0);
        });
    });

    describe('readStream', () => {
        it('should return a ReadStream', async () => {
            const filePath = path.join(tempDir, 'stream.txt');
            await fs.writeFile(filePath, 'stream content');
            const stream = await storage.readStream(filePath);
            expect(stream).toBeDefined();
            expect(typeof stream.pipe).toBe('function');
            stream.destroy();
        });
    });

    describe('hashFile', () => {
        it('should return SHA256 hash of file contents', async () => {
            const filePath = path.join(tempDir, 'hash.txt');
            await fs.writeFile(filePath, 'hello world', 'utf8');
            const expected = crypto.createHash('sha256').update('hello world').digest('hex').slice(0, 16);
            const hash = await storage.hashFile(filePath, 16);
            expect(hash).toBe(expected);
        });

        it('should return different hashes for different content', async () => {
            const file1 = path.join(tempDir, 'hash1.txt');
            const file2 = path.join(tempDir, 'hash2.txt');
            await fs.writeFile(file1, 'content1', 'utf8');
            await fs.writeFile(file2, 'content2', 'utf8');
            const hash1 = await storage.hashFile(file1, 32);
            const hash2 = await storage.hashFile(file2, 32);
            expect(hash1).not.toBe(hash2);
        });

        it('should respect the length parameter', async () => {
            const filePath = path.join(tempDir, 'hash.txt');
            await fs.writeFile(filePath, 'hello', 'utf8');
            const fullHash = await storage.hashFile(filePath, 64);
            const shortHash = await storage.hashFile(filePath, 16);
            expect(fullHash).toHaveLength(64);
            expect(shortHash).toHaveLength(16);
            expect(fullHash.startsWith(shortHash)).toBe(true);
        });
    });

    describe('listFiles', () => {
        it('should list files in a directory', async () => {
            await fs.writeFile(path.join(tempDir, 'a.txt'), 'a');
            await fs.writeFile(path.join(tempDir, 'b.txt'), 'b');
            await fs.mkdir(path.join(tempDir, 'subdir'));

            const files = await storage.listFiles(tempDir);
            expect(files.sort()).toEqual(['a.txt', 'b.txt', 'subdir']);
        });

        it('should return empty array for empty directory', async () => {
            const emptyDir = path.join(tempDir, 'empty');
            await fs.mkdir(emptyDir);
            const files = await storage.listFiles(emptyDir);
            expect(files).toEqual([]);
        });

        it('should throw for non-existing directory', async () => {
            await expect(storage.listFiles(path.join(tempDir, 'nope'))).rejects.toThrow();
        });
    });

    describe('deleteFile', () => {
        it('should delete an existing file', async () => {
            const filePath = path.join(tempDir, 'delete.txt');
            await fs.writeFile(filePath, 'delete me');
            expect(await storage.exists(filePath)).toBe(true);
            await storage.deleteFile(filePath);
            expect(await storage.exists(filePath)).toBe(false);
        });

        it('should throw for non-existing file', async () => {
            await expect(storage.deleteFile(path.join(tempDir, 'nope'))).rejects.toThrow();
        });
    });

    describe('deleteDirectory', () => {
        it('should delete a directory and its contents', async () => {
            const dir = path.join(tempDir, 'to-delete');
            await fs.mkdir(dir);
            await fs.writeFile(path.join(dir, 'file.txt'), 'content');
            await fs.mkdir(path.join(dir, 'subdir'));

            expect(await storage.exists(dir)).toBe(true);
            await storage.deleteDirectory(dir);
            expect(await storage.exists(dir)).toBe(false);
        });

        it('should not throw for non-existing directory (force: true)', async () => {
            await expect(storage.deleteDirectory(path.join(tempDir, 'nope'))).resolves.not.toThrow();
        });
    });

    describe('getFileSize', () => {
        it('should return file size in bytes', async () => {
            const filePath = path.join(tempDir, 'size.txt');
            const content = 'hello world';
            await fs.writeFile(filePath, content, 'utf8');
            const size = await storage.getFileSize(filePath);
            expect(size).toBe(Buffer.byteLength(content, 'utf8'));
        });

        it('should return 0 for empty file', async () => {
            const filePath = path.join(tempDir, 'empty.txt');
            await fs.writeFile(filePath, '');
            expect(await storage.getFileSize(filePath)).toBe(0);
        });

        it('should throw for non-existing file', async () => {
            await expect(storage.getFileSize(path.join(tempDir, 'nope'))).rejects.toThrow();
        });
    });

    describe('create (factory)', () => {
        it('should use console.log when no log function is provided', async () => {
            const storageNoLog = create({});
            // Should not throw - just uses console.log
            expect(storageNoLog.exists).toBeDefined();
            expect(storageNoLog.readFile).toBeDefined();
        });
    });
});
