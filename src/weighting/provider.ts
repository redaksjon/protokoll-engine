/**
 * Weight Model Provider
 * 
 * Provides query interface for entity predictions based on co-occurrence data.
 * Gracefully handles missing models (purely additive - returns empty predictions when unavailable).
 */

import { WeightModel, EntityPrediction, PredictionContext } from './types';

/**
 * WeightModelProvider
 * 
 * Manages a weight model and provides entity prediction queries.
 * Designed to be purely additive - when no model is available, returns empty results
 * without breaking the enhancement pipeline.
 */
export class WeightModelProvider {
    private model: WeightModel | null;

    constructor(model: WeightModel | null = null) {
        this.model = model;
    }

    /**
     * Check if a weight model is available
     * 
     * @returns true if model is loaded, false otherwise
     */
    isAvailable(): boolean {
        return this.model !== null;
    }

    /**
     * Load a weight model into the provider
     * 
     * @param model - Weight model to load
     */
    loadModel(model: WeightModel): void {
        this.model = model;
    }

    /**
     * Clear the current model
     */
    clearModel(): void {
        this.model = null;
    }

    /**
     * Get the current model (for inspection/debugging)
     * 
     * @returns Current weight model or null
     */
    getModel(): WeightModel | null {
        return this.model;
    }

    /**
     * Predict likely entities based on known context
     * 
     * Combines two signals:
     * 1. Co-occurrence: entities that appear with the known entities
     * 2. Project-specific: entities common in the given project (boosted by 1.5x)
     * 
     * @param context - Prediction context with known entities and project
     * @returns Array of entity predictions sorted by score (descending)
     */
    predictLikelyEntities(context: PredictionContext): EntityPrediction[] {
        // Graceful fallback when no model is available
        if (!this.model) {
            return [];
        }

        const {
            knownEntityIds = [],
            projectId,
            maxPredictions = 10,
            minScore = 1
        } = context;

        const predictions = new Map<string, number>();

        // Signal 1: Co-occurrence predictions
        // For each known entity, find entities that co-occur with it
        for (const entityId of knownEntityIds) {
            const cooccurrences = this.model.cooccurrence[entityId];
            if (cooccurrences) {
                for (const [otherEntityId, count] of Object.entries(cooccurrences)) {
                    // Don't predict entities we already know about
                    if (!knownEntityIds.includes(otherEntityId)) {
                        predictions.set(
                            otherEntityId, 
                            (predictions.get(otherEntityId) || 0) + count
                        );
                    }
                }
            }
        }

        // Signal 2: Project-specific predictions (boosted)
        // If we know the project, boost entities that are common in that project
        if (projectId && this.model.byProject[projectId]) {
            for (const [entityId, count] of Object.entries(this.model.byProject[projectId])) {
                // Don't predict entities we already know about
                if (!knownEntityIds.includes(entityId)) {
                    // Boost project-specific entities by 1.5x
                    predictions.set(
                        entityId, 
                        (predictions.get(entityId) || 0) + (count * 1.5)
                    );
                }
            }
        }

        // Convert to array, filter by minimum score, sort by score, and limit results
        return Array.from(predictions.entries())
            .map(([entityId, score]) => ({
                entityId,
                score,
                source: this.determineSource(entityId, knownEntityIds, projectId)
            } as EntityPrediction))
            .filter(p => p.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxPredictions);
    }

    /**
     * Determine the primary source of a prediction
     * 
     * @param entityId - Entity being predicted
     * @param knownEntityIds - Known entities in context
     * @param projectId - Project ID if known
     * @returns Source type
     */
    private determineSource(
        entityId: string, 
        knownEntityIds: string[], 
        projectId?: string
    ): 'cooccurrence' | 'project' | 'global' {
        if (!this.model) return 'global';

        // Check if entity appears in project-specific data
        if (projectId && this.model.byProject[projectId]?.[entityId]) {
            return 'project';
        }

        // Check if entity co-occurs with any known entities
        for (const knownId of knownEntityIds) {
            if (this.model.cooccurrence[knownId]?.[entityId]) {
                return 'cooccurrence';
            }
        }

        return 'global';
    }

    /**
     * Get project-specific entity frequencies
     * 
     * Returns a map of entity IDs to their frequency counts for a given project.
     * Used by the routing classifier to boost project confidence when entities match.
     * 
     * @param projectId - Project identifier
     * @returns Entity frequency map or null if project not in model
     */
    getProjectFrequencies(projectId: string): Record<string, number> | null {
        if (!this.model?.byProject[projectId]) {
            return null;
        }
        return this.model.byProject[projectId];
    }

    /**
     * Get statistics about the current model
     * 
     * @returns Model statistics or null if no model loaded
     */
    getStatistics(): {
        transcriptCount: number;
        entityCount: number;
        cooccurrenceCount: number;
        projectCount: number;
        builtAt: string;
        lastUpdatedAt: string;
    } | null {
        if (!this.model) return null;

        // Count total co-occurrence pairs
        let cooccurrenceCount = 0;
        for (const cooccurrences of Object.values(this.model.cooccurrence)) {
            cooccurrenceCount += Object.keys(cooccurrences).length;
        }

        return {
            transcriptCount: this.model.metadata.transcriptCount,
            entityCount: this.model.metadata.entityCount,
            cooccurrenceCount,
            projectCount: Object.keys(this.model.byProject).length,
            builtAt: this.model.metadata.builtAt,
            lastUpdatedAt: this.model.metadata.lastUpdatedAt
        };
    }
}
