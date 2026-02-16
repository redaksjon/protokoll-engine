/**
 * Weight Model Types
 * 
 * Data structures for entity co-occurrence tracking and weight model management.
 * The weight model tracks which entities appear together in transcripts to improve
 * routing accuracy and LLM enhancement prepositioning.
 */

// EntityReference is re-exported from protokoll-format for type compatibility

/**
 * Per-entity co-occurrence counts: entityId -> cooccurringEntityId -> count
 * 
 * Example:
 * {
 *   "protokoll": {
 *     "redaksjon": 47,
 *     "mcp": 31,
 *     "tim": 22
 *   },
 *   "tim": {
 *     "redaksjon": 58,
 *     "brennpunkt": 12
 *   }
 * }
 */
export interface EntityCooccurrence {
  [entityId: string]: {
    [cooccurringEntityId: string]: number;
  };
}

/**
 * Per-project entity frequency counts: projectId -> entityId -> count
 * 
 * Example:
 * {
 *   "redaksjon": {
 *     "protokoll": 47,
 *     "mcp": 29,
 *     "tim": 22
 *   }
 * }
 */
export interface ProjectEntityFrequency {
  [projectId: string]: {
    [entityId: string]: number;
  };
}

/**
 * Per-transcript snapshot of which entities were present.
 * Keyed by transcript UUID. Used for incremental updates:
 * when a transcript's entities change, subtract the old snapshot
 * and add the new one.
 * 
 * Example:
 * {
 *   "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
 *     "entityIds": ["protokoll", "mcp", "tim", "redaksjon"],
 *     "projectId": "redaksjon"
 *   }
 * }
 */
export interface TranscriptEntitySnapshot {
  [transcriptUuid: string]: {
    entityIds: string[];
    projectId?: string;
  };
}

/**
 * Complete weight model structure
 */
export interface WeightModel {
  /** Entity-to-entity co-occurrence matrix */
  cooccurrence: EntityCooccurrence;
  
  /** Project-specific entity frequencies */
  byProject: ProjectEntityFrequency;
  
  /** Tracks which transcripts contributed to the model, keyed by UUID */
  transcriptSnapshots: TranscriptEntitySnapshot;
  
  /** Model metadata */
  metadata: {
    builtAt: string;
    lastUpdatedAt: string;
    transcriptCount: number;
    entityCount: number;
    version: string;
  };
}

/**
 * Configuration for weight model building
 */
export interface WeightModelConfig {
  /** Maximum number of transcripts to scan (most recent) */
  maxTranscripts: number;
  
  /** Minimum co-occurrence count to include in output (noise filter) */
  minCooccurrenceCount: number;
  
  /** Path where the weight model JSON file should be written */
  outputFilePath: string;
}

/**
 * Entity prediction result for a given context
 */
export interface EntityPrediction {
  entityId: string;
  entityName?: string;
  entityType?: 'person' | 'project' | 'term' | 'company';
  score: number;
  source: 'cooccurrence' | 'project' | 'global';
}

/**
 * Context for making entity predictions
 */
export interface PredictionContext {
  /** Known entity IDs in the current context */
  knownEntityIds?: string[];
  
  /** Project ID if known */
  projectId?: string;
  
  /** Maximum number of predictions to return */
  maxPredictions?: number;
  
  /** Minimum score threshold */
  minScore?: number;
}
