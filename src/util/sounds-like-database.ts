/**
 * Sounds-Like Database
 *
 * Aggregates sounds_like mappings from multiple sources (projects, people, terms)
 * and provides efficient lookup and collision detection for entity correction.
 *
 * Part of the simple-replace optimization (Phase 1).
 */

import * as Logging from '@/logging';
import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Represents a single sounds_like mapping entry
 */
export interface SoundsLikeMapping {
    /** What Whisper typically hears (e.g., "protocol", "observation") */
    soundsLike: string;

    /** Correct text to replace with (e.g., "Protokoll", "Observasjon") */
    correctText: string;

    /** Type of entity (project, person, or term) */
    entityType: 'project' | 'person' | 'term';

    /** Unique identifier for the entity */
    entityId: string;

    /** Only apply replacement in these project contexts (null = apply everywhere) */
    scopedToProjects?: string[] | null;

    /** Collision risk level: none (Tier 1), low/medium (Tier 2), high (Tier 3) */
    collisionRisk: 'none' | 'low' | 'medium' | 'high';

    /** Tier classification (1 = always safe, 2 = project-scoped, 3 = ambiguous) */
    tier: 1 | 2 | 3;

    /** Minimum confidence required for Tier 2 replacements */
    minConfidence?: number;
}

/**
 * Collision information for a sounds_like value
 */
export interface Collision {
    /** The sounds_like value that has collisions */
    soundsLike: string;

    /** All mappings that share this sounds_like value */
    mappings: SoundsLikeMapping[];

    /** Number of conflicting mappings */
    count: number;
}

/**
 * Database of sounds_like mappings with collision detection
 */
export interface SoundsLikeDatabase {
    /** All loaded mappings */
    mappings: SoundsLikeMapping[];

    /** Tier 1 mappings (always safe to apply) */
    tier1: SoundsLikeMapping[];

    /** Tier 2 mappings (require project-scoping) */
    tier2: Map<string, SoundsLikeMapping[]>; // Keyed by project ID

    /** Tier 3 mappings (too ambiguous, skip) */
    tier3: SoundsLikeMapping[];

    /** Detected collisions */
    collisions: Map<string, Collision>;

    /** Common terms that should not be replaced */
    commonTerms: Set<string>;

    /** Generic terms to always skip (Tier 3) */
    genericTerms: Set<string>;
}

/**
 * Configuration for the sounds-like database
 */
export interface DatabaseConfig {
    /** Protokoll context directories to load from */
    protokollContextPaths?: string[];

    /** Confidence threshold for Tier 2 replacements */
    tier2Confidence?: number;

    /** Enable collision detection */
    detectCollisions?: boolean;

    /** Custom common terms list */
    commonTerms?: string[];

    /** Custom generic terms list */
    genericTerms?: string[];
}

/**
 * Instance interface for the sounds-like database
 */
export interface Instance {
    /** Load all sounds_like mappings from sources */
    load(): Promise<SoundsLikeDatabase>;

    /** Get all Tier 1 (always safe) mappings */
    getTier1Mappings(): SoundsLikeMapping[];

    /** Get Tier 2 (project-scoped) mappings for a specific project */
    getTier2MappingsForProject(projectId: string): SoundsLikeMapping[];

    /** Check if a sounds_like value has collisions */
    hasCollision(soundsLike: string): boolean;

    /** Get collision info for a sounds_like value */
    getCollision(soundsLike: string): Collision | undefined;

    /** Get all collisions */
    getAllCollisions(): Collision[];

    /** Classify a mapping into a tier based on collision risk */
    classifyTier(mapping: Partial<SoundsLikeMapping>): 1 | 2 | 3;
}

interface ProtokolProject {
    id: string;
    name: string;
    type: 'project';
    sounds_like?: string[];
    classification?: {
        context_type?: 'work' | 'personal' | 'mixed';
    };
    active?: boolean;
}

/**
 * Create a sounds-like database instance
 */
export const create = (config?: DatabaseConfig): Instance => {
    const logger = Logging.getLogger();

    const database: SoundsLikeDatabase = {
        mappings: [],
        tier1: [],
        tier2: new Map(),
        tier3: [],
        collisions: new Map(),
        commonTerms: new Set(config?.commonTerms ?? DEFAULT_COMMON_TERMS),
        genericTerms: new Set(config?.genericTerms ?? DEFAULT_GENERIC_TERMS),
    };

    /**
     * Find protokoll context directories
     */
    const findProtokolDirectories = async (): Promise<string[]> => {
        if (config?.protokollContextPaths) {
            return config.protokollContextPaths;
        }

        const homeDir = os.homedir();
        const primaryPath = path.join(homeDir, '.protokoll', 'context');

        const dirs: string[] = [];

        // Check primary protokoll directory
        try {
            await fs.access(primaryPath);
            dirs.push(primaryPath);
            logger.debug(`Found protokoll context at: ${primaryPath}`);
        } catch {
            logger.debug(`No protokoll context found at: ${primaryPath}`);
        }

        return dirs;
    };

    /**
     * Load projects from protokoll context
     */
    const loadProjectsFromProtokoll = async (): Promise<SoundsLikeMapping[]> => {
        logger.debug('Loading projects from protokoll context');

        const contextDirs = await findProtokolDirectories();

        if (contextDirs.length === 0) {
            logger.warn('No protokoll context directories found');
            return [];
        }

        const mappings: SoundsLikeMapping[] = [];

        for (const contextDir of contextDirs) {
            const projectsDir = path.join(contextDir, 'projects');

            try {
                const files = await fs.readdir(projectsDir);

                for (const file of files) {
                    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

                    try {
                        const content = await fs.readFile(path.join(projectsDir, file), 'utf-8');
                        const parsed = yaml.load(content) as Partial<ProtokolProject>;

                        if (!parsed || !parsed.id || !parsed.name) {
                            logger.debug(`Skipping invalid project file: ${file}`);
                            continue;
                        }

                        // Skip inactive projects
                        if (parsed.active === false) {
                            logger.debug(`Skipping inactive project: ${parsed.id}`);
                            continue;
                        }

                        // Process sounds_like entries
                        if (parsed.sounds_like && parsed.sounds_like.length > 0) {
                            for (const soundsLike of parsed.sounds_like) {
                                mappings.push({
                                    soundsLike: soundsLike.toLowerCase(),
                                    correctText: parsed.name,
                                    entityType: 'project',
                                    entityId: parsed.id,
                                    scopedToProjects: null, // Will be determined by collision detection
                                    collisionRisk: 'none', // Will be determined by collision detection
                                    tier: 1, // Will be determined by collision detection
                                });
                            }
                            logger.debug(`Loaded ${parsed.sounds_like.length} sounds_like entries for project: ${parsed.id}`);
                        }
                    } catch (error: any) {
                        logger.warn(`Failed to parse project file ${file}: ${error.message}`);
                    }
                }
            } catch (error: any) {
                logger.debug(`Could not read projects directory ${projectsDir}: ${error.message}`);
            }
        }

        logger.info(`Loaded ${mappings.length} sounds_like mappings from protokoll projects`);
        return mappings;
    };

    /**
     * Detect collisions in mappings
     */
    const detectCollisions = (mappings: SoundsLikeMapping[]): Map<string, Collision> => {
        const collisionMap = new Map<string, SoundsLikeMapping[]>();

        // Group by sounds_like value (case-insensitive)
        for (const mapping of mappings) {
            const key = mapping.soundsLike.toLowerCase();
            if (!collisionMap.has(key)) {
                collisionMap.set(key, []);
            }
            collisionMap.get(key)!.push(mapping);
        }

        // Identify actual collisions (multiple mappings for same sounds_like)
        const collisions = new Map<string, Collision>();
        for (const [soundsLike, conflictMappings] of collisionMap) {
            if (conflictMappings.length > 1) {
                collisions.set(soundsLike, {
                    soundsLike,
                    mappings: conflictMappings,
                    count: conflictMappings.length,
                });
                logger.debug(`Collision detected for "${soundsLike}": ${conflictMappings.length} mappings`);
            }
        }

        logger.info(`Detected ${collisions.size} collisions in sounds_like mappings`);
        return collisions;
    };

    /**
     * Classify a mapping into a tier based on collision risk
     */
    const classifyTier = (mapping: Partial<SoundsLikeMapping>): 1 | 2 | 3 => {
        if (!mapping.soundsLike) {
            return 3; // Invalid, treat as ambiguous
        }

        const soundsLikeLower = mapping.soundsLike.toLowerCase();

        // Tier 3: Generic terms (always skip)
        if (database.genericTerms.has(soundsLikeLower)) {
            return 3;
        }

        // Tier 2: Common terms (require project-scoping)
        if (database.commonTerms.has(soundsLikeLower)) {
            return 2;
        }

        // Tier 2: Has collision with other mappings
        if (database.collisions.has(soundsLikeLower)) {
            return 2;
        }

        // Tier 1: Unique, no collisions, not a common term
        return 1;
    };

    /**
     * Assign tiers and collision info to all mappings
     */
    const assignTiersAndCollisions = (mappings: SoundsLikeMapping[]): void => {
        for (const mapping of mappings) {
            // Classify tier
            mapping.tier = classifyTier(mapping);

            // Determine collision risk
            if (database.collisions.has(mapping.soundsLike.toLowerCase())) {
                mapping.collisionRisk = 'high';
            } else if (database.commonTerms.has(mapping.soundsLike.toLowerCase())) {
                mapping.collisionRisk = 'medium';
            } else if (mapping.tier === 2) {
                mapping.collisionRisk = 'low';
            } else {
                mapping.collisionRisk = 'none';
            }

            // Scope to projects for Tier 2
            if (mapping.tier === 2 && mapping.entityType === 'project') {
                mapping.scopedToProjects = [mapping.entityId];
                mapping.minConfidence = config?.tier2Confidence ?? 0.6;
            }

            logger.debug(
                `Classified "${mapping.soundsLike}" → "${mapping.correctText}" ` +
                `(${mapping.entityType}:${mapping.entityId}) as Tier ${mapping.tier} ` +
                `(risk: ${mapping.collisionRisk})`
            );
        }
    };

    /**
     * Organize mappings by tier
     */
    const organizeMappingsByTier = (mappings: SoundsLikeMapping[]): void => {
        database.tier1 = [];
        database.tier2 = new Map();
        database.tier3 = [];

        for (const mapping of mappings) {
            if (mapping.tier === 1) {
                database.tier1.push(mapping);
            } else if (mapping.tier === 2) {
                // Organize Tier 2 by project ID for efficient lookup
                if (mapping.entityType === 'project') {
                    if (!database.tier2.has(mapping.entityId)) {
                        database.tier2.set(mapping.entityId, []);
                    }
                    database.tier2.get(mapping.entityId)!.push(mapping);
                } else {
                    // For non-project entities in Tier 2, add to a generic bucket
                    if (!database.tier2.has('_generic')) {
                        database.tier2.set('_generic', []);
                    }
                    database.tier2.get('_generic')!.push(mapping);
                }
            } else {
                database.tier3.push(mapping);
            }
        }

        logger.info(
            `Organized mappings: Tier 1=${database.tier1.length}, ` +
            `Tier 2=${Array.from(database.tier2.values()).reduce((sum, arr) => sum + arr.length, 0)}, ` +
            `Tier 3=${database.tier3.length}`
        );
    };

    /**
     * Load all sounds_like mappings
     */
    const load = async (): Promise<SoundsLikeDatabase> => {
        logger.info('Loading sounds_like database');

        // Load from all sources
        const projectMappings = await loadProjectsFromProtokoll();
        // TODO: Load from people source
        // TODO: Load from terms source

        const allMappings = [
            ...projectMappings,
            // ...peopleMappings,
            // ...termMappings,
        ];

        database.mappings = allMappings;

        // Detect collisions
        if (config?.detectCollisions !== false) {
            database.collisions = detectCollisions(allMappings);
        }

        // Assign tiers and collision info
        assignTiersAndCollisions(allMappings);

        // Organize by tier for efficient lookup
        organizeMappingsByTier(allMappings);

        logger.info(`Sounds_like database loaded: ${allMappings.length} total mappings`);

        return database;
    };

    /**
     * Get Tier 1 mappings (always safe)
     */
    const getTier1Mappings = (): SoundsLikeMapping[] => {
        return database.tier1;
    };

    /**
     * Get Tier 2 mappings for a specific project
     */
    const getTier2MappingsForProject = (projectId: string): SoundsLikeMapping[] => {
        const projectMappings = database.tier2.get(projectId) ?? [];
        const genericMappings = database.tier2.get('_generic') ?? [];
        return [...projectMappings, ...genericMappings];
    };

    /**
     * Check if a sounds_like value has collisions
     */
    const hasCollision = (soundsLike: string): boolean => {
        return database.collisions.has(soundsLike.toLowerCase());
    };

    /**
     * Get collision info
     */
    const getCollision = (soundsLike: string): Collision | undefined => {
        return database.collisions.get(soundsLike.toLowerCase());
    };

    /**
     * Get all collisions
     */
    const getAllCollisions = (): Collision[] => {
        return Array.from(database.collisions.values());
    };

    return {
        load,
        getTier1Mappings,
        getTier2MappingsForProject,
        hasCollision,
        getCollision,
        getAllCollisions,
        classifyTier,
    };
};

/**
 * Default common terms that indicate Tier 2 (project-scoped) replacements
 */
const DEFAULT_COMMON_TERMS = [
    'protocol',
    'observation',
    'composition',
    'gateway',
    'service',
    'system',
    'platform',
];

/**
 * Default generic terms that should never be replaced (Tier 3)
 */
const DEFAULT_GENERIC_TERMS = [
    'meeting',
    'update',
    'work',
    'project',
    'task',
    'issue',
    'discussion',
    'review',
    'the',
    'a',
    'an',
];
