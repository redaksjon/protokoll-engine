import * as Logging from '@/logging';
import * as Media from '@/util/media';
import * as Storage from '@/util/storage';
import * as Dreadcabinet from '@utilarium/dreadcabinet';
import * as Dates from '@/util/dates';
import { Config } from '@/types';
import { DEFAULT_INTERMEDIATE_DIRECTORY } from '@/constants';
import path from 'node:path';

// Helper function to promisify ffmpeg.

export interface Instance {
    locate: (audioFile: string) => Promise<{
        creationTime: Date;
        outputPath: string;
        contextPath: string;
        interimPath: string;
        transcriptionFilename: string;
        hash: string;
        audioFile: string;
    }>;
}

export const create = (config: Config, operator: Dreadcabinet.Operator): Instance => {
    const logger = Logging.getLogger();
    const storage = Storage.create({ log: logger.debug });
    const dates = Dates.create({ timezone: config.timezone });
    const media = Media.create(logger);

    const locate = async (audioFile: string): Promise<{
        creationTime: Date;
        outputPath: string;
        contextPath: string;
        interimPath: string;
        transcriptionFilename: string;
        hash: string;
        audioFile: string;
    }> => {
        logger.debug('Processing file %s', audioFile);

        // Extract audio file creation time
        let creationTime = await media.getAudioCreationTime(audioFile);
        try {
            if (creationTime) {
                logger.info('Audio recording time: %s', creationTime.toISOString());
            } else {
                logger.warn('Could not determine audio recording time for %s, using current date', audioFile);
                creationTime = dates.now();
            }
        } catch (error: any) {
            logger.error('Error determining audio recording time for %s: %s, using current date', audioFile, error.message);
            creationTime = dates.now();
        }

        // Calculate the hash of file and output directory
        const hash = (await storage.hashFile(audioFile, 100)).substring(0, 8);
        const outputPath: string = await operator.constructOutputDirectory(creationTime);
        const transcriptionFilename = await operator.constructFilename(creationTime, 'transcription', hash);
        
        // Use output/protokoll for intermediate files instead of polluting output directory
        // This follows the kodrdriv pattern for debugging and intermediate file management
        const intermediateBase = DEFAULT_INTERMEDIATE_DIRECTORY;
        const shortHash = hash.substring(0, 6);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timestamp = `${creationTime.getFullYear().toString().slice(2)}${pad(creationTime.getMonth() + 1)}${pad(creationTime.getDate())}-${pad(creationTime.getHours())}${pad(creationTime.getMinutes())}`;
        const sessionDir = `${timestamp}-${shortHash}`;
        
        const interimPath: string = path.join(intermediateBase, sessionDir);
        await storage.createDirectory(interimPath);
        
        const contextPath: string = path.join(interimPath, 'context');
        await storage.createDirectory(contextPath);
        
        logger.debug('Intermediate files will be stored in: %s', interimPath);

        return {
            creationTime,
            outputPath,
            contextPath,
            interimPath,
            transcriptionFilename,
            hash,
            audioFile,
        };
    }

    return {
        locate,
    }
}


