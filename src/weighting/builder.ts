/**
 * Weight Model Builder
 * 
 * Constructs entity co-occurrence graphs from transcript data.
 * Supports both full builds (scan all transcripts) and incremental updates
 * (add/subtract individual transcript contributions).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { 
    WeightModel, 
    WeightModelConfig, 
    EntityCooccurrence, 
    ProjectEntityFrequency, 
    TranscriptEntitySnapshot 
} from './types';
import { 
    listTranscripts, 
    PklTranscript,
    type TranscriptEntities 
} from '@redaksjon/protokoll-format';

/**
 * WeightModelBuilder
 * 
 * Builds entity co-occurrence matrices from transcript data with UUID provenance tracking.
 */
export class WeightModelBuilder {
    constructor(private config: WeightModelConfig) {}

    /**
   * Build a complete weight model by scanning transcripts in a directory
   * 
   * @param transcriptDirectory - Directory containing .pkl transcript files
   * @returns Complete weight model with co-occurrence data and provenance
   */
    async build(transcriptDirectory: string): Promise<WeightModel> {
        const result = await listTranscripts({
            directory: transcriptDirectory,
            limit: this.config.maxTranscripts,
            sortBy: 'date',
            sortOrder: 'desc'
        });

        const cooccurrence: EntityCooccurrence = {};
        const byProject: ProjectEntityFrequency = {};
        const transcriptSnapshots: TranscriptEntitySnapshot = {};
        let totalEntities = 0;

        for (const transcriptItem of result.transcripts) {
            // Open the transcript to get full metadata including UUID
            const transcript = PklTranscript.open(transcriptItem.filePath, { readOnly: true });
            const metadata = transcript.metadata;
            transcript.close();

            // Extract entity IDs from the transcript
            const entityIds = this.extractEntityIds(metadata.entities);
            if (entityIds.length === 0) continue;

            // Record UUID provenance snapshot
            transcriptSnapshots[metadata.id] = {
                entityIds,
                projectId: metadata.project || undefined,
            };

            // Build co-occurrence matrix
            this.addCooccurrences(entityIds, cooccurrence);
      
            // Track project-specific frequencies  
            if (metadata.project) {
                this.addProjectFrequencies(metadata.project, entityIds, byProject);
            }
      
            totalEntities += entityIds.length;
        }

        const now = new Date().toISOString();
        return {
            cooccurrence: this.filterMinCounts(cooccurrence),
            byProject,
            transcriptSnapshots,
            metadata: {
                builtAt: now,
                lastUpdatedAt: now,
                transcriptCount: result.transcripts.length,
                entityCount: totalEntities,
                version: '1.0.0'
            }
        };
    }

    /**
   * Extract entity IDs from transcript entities
   * 
   * @param entities - TranscriptEntities object with people, projects, terms, companies
   * @returns Array of entity IDs
   */
    private extractEntityIds(entities?: TranscriptEntities): string[] {
        if (!entities) return [];

        const ids: string[] = [];
    
        if (entities.people) {
            ids.push(...entities.people.map(e => e.id));
        }
        if (entities.projects) {
            ids.push(...entities.projects.map(e => e.id));
        }
        if (entities.terms) {
            ids.push(...entities.terms.map(e => e.id));
        }
        if (entities.companies) {
            ids.push(...entities.companies.map(e => e.id));
        }
    
        return ids;
    }

    /**
   * Add co-occurrence counts for a set of entity IDs.
   * Every pair of entities in the list gets +1.
   * 
   * This is a public method so it can be used for incremental updates.
   * 
   * @param entityIds - Array of entity IDs that co-occur
   * @param cooccurrence - Co-occurrence matrix to update (mutated in place)
   */
    addCooccurrences(entityIds: string[], cooccurrence: EntityCooccurrence): void {
    // For each pair of entities, increment their co-occurrence count
        for (let i = 0; i < entityIds.length; i++) {
            for (let j = i + 1; j < entityIds.length; j++) {
                const a = entityIds[i];
                const b = entityIds[j];
        
                // Initialize if needed
                if (!cooccurrence[a]) cooccurrence[a] = {};
                if (!cooccurrence[b]) cooccurrence[b] = {};
        
                // Increment bidirectionally
                cooccurrence[a][b] = (cooccurrence[a][b] || 0) + 1;
                cooccurrence[b][a] = (cooccurrence[b][a] || 0) + 1;
            }
        }
    }

    /**
   * Subtract co-occurrence counts for a set of entity IDs.
   * Used during incremental updates when removing a transcript's
   * old entity snapshot before adding the new one.
   * 
   * This is a public method so it can be used for incremental updates.
   * 
   * @param entityIds - Array of entity IDs to remove
   * @param cooccurrence - Co-occurrence matrix to update (mutated in place)
   */
    subtractCooccurrences(entityIds: string[], cooccurrence: EntityCooccurrence): void {
    // For each pair of entities, decrement their co-occurrence count
        for (let i = 0; i < entityIds.length; i++) {
            for (let j = i + 1; j < entityIds.length; j++) {
                const a = entityIds[i];
                const b = entityIds[j];
        
                // Decrement bidirectionally
                if (cooccurrence[a]?.[b]) {
                    cooccurrence[a][b]--;
                    if (cooccurrence[a][b] <= 0) {
                        delete cooccurrence[a][b];
                    }
                }
                if (cooccurrence[b]?.[a]) {
                    cooccurrence[b][a]--;
                    if (cooccurrence[b][a] <= 0) {
                        delete cooccurrence[b][a];
                    }
                }
        
                // Clean up empty entity entries
                if (cooccurrence[a] && Object.keys(cooccurrence[a]).length === 0) {
                    delete cooccurrence[a];
                }
                if (cooccurrence[b] && Object.keys(cooccurrence[b]).length === 0) {
                    delete cooccurrence[b];
                }
            }
        }
    }

    /**
   * Add project-specific entity frequencies
   * 
   * @param projectId - Project identifier
   * @param entityIds - Entity IDs to add
   * @param byProject - Project frequency map to update (mutated in place)
   */
    addProjectFrequencies(
        projectId: string, 
        entityIds: string[], 
        byProject: ProjectEntityFrequency
    ): void {
        if (!byProject[projectId]) {
            byProject[projectId] = {};
        }
    
        for (const entityId of entityIds) {
            byProject[projectId][entityId] = (byProject[projectId][entityId] || 0) + 1;
        }
    }

    /**
   * Subtract project-specific entity frequencies
   * Used during incremental updates when removing a transcript's old snapshot
   * 
   * @param projectId - Project identifier
   * @param entityIds - Entity IDs to remove
   * @param byProject - Project frequency map to update (mutated in place)
   */
    subtractProjectFrequencies(
        projectId: string, 
        entityIds: string[], 
        byProject: ProjectEntityFrequency
    ): void {
        if (!byProject[projectId]) return;
    
        for (const entityId of entityIds) {
            if (byProject[projectId][entityId]) {
                byProject[projectId][entityId]--;
                if (byProject[projectId][entityId] <= 0) {
                    delete byProject[projectId][entityId];
                }
            }
        }
    
        // Clean up empty project entries
        if (Object.keys(byProject[projectId]).length === 0) {
            delete byProject[projectId];
        }
    }

    /**
     * Filter co-occurrence matrix to remove low-frequency pairs (noise reduction)
     * 
     * @param cooccurrence - Raw co-occurrence matrix
     * @returns Filtered matrix with only counts >= minCooccurrenceCount
     */
    private filterMinCounts(cooccurrence: EntityCooccurrence): EntityCooccurrence {
        const filtered: EntityCooccurrence = {};
    
        for (const [entityId, cooccurring] of Object.entries(cooccurrence)) {
            const filteredCooccurring: { [key: string]: number } = {};
      
            for (const [cooccurringId, count] of Object.entries(cooccurring)) {
                if (count >= this.config.minCooccurrenceCount) {
                    filteredCooccurring[cooccurringId] = count;
                }
            }
      
            if (Object.keys(filteredCooccurring).length > 0) {
                filtered[entityId] = filteredCooccurring;
            }
        }
    
        return filtered;
    }

    /**
     * Write weight model to JSON file
     * 
     * Creates human-readable JSON output with proper formatting.
     * Ensures output directory exists before writing.
     * 
     * @param model - Weight model to write
     * @param filePath - Destination file path
     */
    async writeToFile(model: WeightModel, filePath: string): Promise<void> {
        // Ensure output directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
    
        // Write human-readable JSON with formatting
        const jsonContent = JSON.stringify(model, null, 2);
        await fs.writeFile(filePath, jsonContent, 'utf-8');
    }

    /**
     * Build weight model and write to configured output file
     * 
     * Convenience method that combines build() and writeToFile().
     * 
     * @param transcriptDirectory - Directory containing .pkl transcript files
     * @returns Built weight model
     */
    async buildAndWrite(transcriptDirectory: string): Promise<WeightModel> {
        const model = await this.build(transcriptDirectory);
        await this.writeToFile(model, this.config.outputFilePath);
        return model;
    }

    /**
     * Load weight model from JSON file
     * 
     * Static method for loading previously built models.
     * Returns null if file doesn't exist or can't be parsed.
     * 
     * @param filePath - Path to weight model JSON file
     * @returns Loaded weight model or null
     */
    static async loadFromFile(filePath: string): Promise<WeightModel | null> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as WeightModel;
        } catch {
            // File doesn't exist or invalid JSON - return null
            return null;
        }
    }

    /**
     * Incrementally update the weight model when a single transcript's entities change
     * 
     * Uses UUID provenance to identify what changed:
     * 1. Look up the old snapshot for this transcript
     * 2. Subtract old co-occurrences and project frequencies
     * 3. Add new co-occurrences and project frequencies
     * 4. Update the snapshot
     * 
     * The model is mutated in place for efficiency.
     * 
     * @param model - The current weight model (mutated in place)
     * @param transcriptUuid - The UUID of the transcript that changed
     * @param newEntityIds - The new set of entity IDs on this transcript
     * @param newProjectId - The project this transcript is routed to (may have changed)
     */
    updateTranscript(
        model: WeightModel,
        transcriptUuid: string,
        newEntityIds: string[],
        newProjectId?: string
    ): void {
        const oldSnapshot = model.transcriptSnapshots[transcriptUuid];

        // Subtract old co-occurrences and project frequencies
        if (oldSnapshot) {
            this.subtractCooccurrences(oldSnapshot.entityIds, model.cooccurrence);
            if (oldSnapshot.projectId) {
                this.subtractProjectFrequencies(oldSnapshot.projectId, oldSnapshot.entityIds, model.byProject);
            }
        }

        // Add new co-occurrences and project frequencies
        if (newEntityIds.length > 0) {
            this.addCooccurrences(newEntityIds, model.cooccurrence);
            if (newProjectId) {
                this.addProjectFrequencies(newProjectId, newEntityIds, model.byProject);
            }
            
            // Update snapshot
            model.transcriptSnapshots[transcriptUuid] = {
                entityIds: newEntityIds,
                projectId: newProjectId
            };
        } else {
            // Transcript has no entities -- remove its snapshot
            delete model.transcriptSnapshots[transcriptUuid];
        }

        // Update metadata
        model.metadata.lastUpdatedAt = new Date().toISOString();
    }

    /**
     * Remove a transcript from the model entirely
     * 
     * Used when a transcript is deleted.
     * Convenience method that calls updateTranscript with empty entity list.
     * 
     * @param model - The current weight model (mutated in place)
     * @param transcriptUuid - The UUID of the transcript to remove
     */
    removeTranscript(model: WeightModel, transcriptUuid: string): void {
        this.updateTranscript(model, transcriptUuid, [], undefined);
    }
}
