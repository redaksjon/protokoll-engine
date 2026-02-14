/**
 * Decision Tracker
 * 
 * Tracks classification decisions for feedback and learning.
 * Stores a history of decisions that can be reviewed and corrected.
 */

import * as fs from 'fs/promises';
import * as path from 'node:path';
import { ClassificationDecision } from './types';
import * as Logging from '../logging';

export interface TrackerInstance {
    recordDecision(decision: Omit<ClassificationDecision, 'id' | 'timestamp'>): ClassificationDecision;
    getRecentDecisions(limit?: number): Promise<ClassificationDecision[]>;
    getDecision(id: string): Promise<ClassificationDecision | null>;
    updateFeedbackStatus(id: string, status: 'correct' | 'incorrect'): Promise<void>;
    saveDecisions(): Promise<void>;
}

export interface TrackerConfig {
    storageDir: string;
    maxInMemory: number;
}

export const create = (config: TrackerConfig): TrackerInstance => {
    const logger = Logging.getLogger();
    const decisions: Map<string, ClassificationDecision> = new Map();

    const generateId = (): string => {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `dec-${timestamp}-${random}`;
    };

    const recordDecision = (partial: Omit<ClassificationDecision, 'id' | 'timestamp'>): ClassificationDecision => {
        const decision: ClassificationDecision = {
            ...partial,
            id: generateId(),
            timestamp: new Date(),
        };

        decisions.set(decision.id, decision);
        logger.debug('Recorded decision: %s', decision.id);

        // Keep only most recent in memory
        if (decisions.size > config.maxInMemory) {
            const oldest = Array.from(decisions.keys())[0];
            decisions.delete(oldest);
        }

        return decision;
    };

    const getRecentDecisions = async (limit = 10): Promise<ClassificationDecision[]> => {
        // First check in-memory decisions
        const inMemory = Array.from(decisions.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);

        if (inMemory.length >= limit) {
            return inMemory;
        }

        // Load from disk if needed
        try {
            const files = await fs.readdir(config.storageDir);
            const decisionFiles = files
                .filter(f => f.startsWith('decision-') && f.endsWith('.json'))
                .sort()
                .reverse()
                .slice(0, limit - inMemory.length);

            for (const file of decisionFiles) {
                const content = await fs.readFile(path.join(config.storageDir, file), 'utf-8');
                const decision = JSON.parse(content) as ClassificationDecision;
                decision.timestamp = new Date(decision.timestamp);
                if (!decisions.has(decision.id)) {
                    inMemory.push(decision);
                }
            }
        } catch {
            // Directory might not exist yet
        }

        return inMemory.slice(0, limit);
    };

    const getDecision = async (id: string): Promise<ClassificationDecision | null> => {
        // Check in-memory first
        if (decisions.has(id)) {
            return decisions.get(id)!;
        }

        // Try to load from disk
        try {
            const filepath = path.join(config.storageDir, `decision-${id}.json`);
            const content = await fs.readFile(filepath, 'utf-8');
            const decision = JSON.parse(content) as ClassificationDecision;
            decision.timestamp = new Date(decision.timestamp);
            return decision;
        } catch {
            return null;
        }
    };

    const updateFeedbackStatus = async (id: string, status: 'correct' | 'incorrect'): Promise<void> => {
        const decision = await getDecision(id);
        if (!decision) {
            logger.warn('Decision not found: %s', id);
            return;
        }

        decision.feedbackStatus = status;
        decisions.set(id, decision);
        
        // Save to disk
        await fs.mkdir(config.storageDir, { recursive: true });
        const filepath = path.join(config.storageDir, `decision-${id}.json`);
        await fs.writeFile(filepath, JSON.stringify(decision, null, 2), 'utf-8');
        
        logger.info('Updated feedback status for %s: %s', id, status);
    };

    const saveDecisions = async (): Promise<void> => {
        await fs.mkdir(config.storageDir, { recursive: true });
        
        for (const [id, decision] of decisions) {
            const filepath = path.join(config.storageDir, `decision-${id}.json`);
            await fs.writeFile(filepath, JSON.stringify(decision, null, 2), 'utf-8');
        }
        
        logger.debug('Saved %d decisions to disk', decisions.size);
    };

    return {
        recordDecision,
        getRecentDecisions,
        getDecision,
        updateFeedbackStatus,
        saveDecisions,
    };
};

