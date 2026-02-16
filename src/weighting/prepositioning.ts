/**
 * Entity Prepositioning
 * 
 * Generates LLM guidance from weight model predictions to improve entity recognition.
 * Converts entity predictions into structured guidance that can be injected into
 * the LLM system prompt during agentic enhancement.
 */

import { WeightModelProvider } from './provider';
import { EntityPrediction, PredictionContext } from './types';
import type { EntityReference } from '@redaksjon/protokoll-format';
import * as Context from '@redaksjon/context';

/**
 * Entity prepositioning guidance for LLM enhancement
 */
export interface EntityPrepositioningGuidance {
    /** List of likely entities with metadata */
    likelyEntities: Array<{
        id: string;
        name: string;
        type: 'person' | 'project' | 'term' | 'company';
        confidence: string;
    }>;
    
    /** Formatted guidance text for LLM system prompt */
    guidance: string;
}

/**
 * EntityPrepositioner
 * 
 * Generates entity guidance for LLM enhancement based on weight model predictions.
 * Resolves entity IDs to full entity details using the context system.
 */
export class EntityPrepositioner {
    constructor(
        private weightModelProvider: WeightModelProvider,
        private contextInstance: Context.ContextInstance
    ) {}

    /**
     * Generate entity prepositioning guidance
     * 
     * @param projectId - Optional project ID for project-specific predictions
     * @param knownEntities - Entities already identified in the transcript
     * @returns Entity guidance for LLM prompt
     */
    generateGuidance(
        projectId?: string,
        knownEntities: EntityReference[] = []
    ): EntityPrepositioningGuidance {
        // Graceful fallback when no model is available
        if (!this.weightModelProvider.isAvailable()) {
            return { likelyEntities: [], guidance: '' };
        }

        // Get predictions from weight model
        const knownEntityIds = knownEntities.map(e => e.id);
        const context: PredictionContext = {
            knownEntityIds,
            projectId,
            maxPredictions: 8,  // Limit to avoid overwhelming the LLM
            minScore: 2  // Filter out very low-confidence predictions
        };
        
        const predictions = this.weightModelProvider.predictLikelyEntities(context);

        // Resolve predictions to full entity details
        const likelyEntities = predictions
            .map((pred: EntityPrediction) => this.resolvePredictionToEntity(pred))
            .filter((entity: ReturnType<typeof this.resolvePredictionToEntity>): entity is NonNullable<typeof entity> => entity !== null);

        // Return empty guidance if no predictions
        if (likelyEntities.length === 0) {
            return { likelyEntities: [], guidance: '' };
        }

        return {
            likelyEntities,
            guidance: this.formatGuidancePrompt(likelyEntities, projectId)
        };
    }

    /**
     * Format entity predictions into LLM guidance text
     * 
     * @param entities - Resolved entity predictions
     * @param projectId - Optional project ID
     * @returns Formatted guidance text
     */
    private formatGuidancePrompt(
        entities: EntityPrepositioningGuidance['likelyEntities'],
        projectId?: string
    ): string {
        // Group entities by type
        const byType = entities.reduce((acc, entity) => {
            if (!acc[entity.type]) {
                acc[entity.type] = [];
            }
            acc[entity.type].push(`${entity.name} (${entity.id})`);
            return acc;
        }, {} as Record<string, string[]>);

        // Build guidance sections
        const sections: string[] = [];
        
        if (projectId) {
            sections.push(`This transcript is likely related to project: ${projectId}`);
        }
        
        sections.push('Based on patterns in similar transcripts, these entities are likely to appear:');
        
        if (byType.person) {
            sections.push(`- People: ${byType.person.join(', ')}`);
        }
        if (byType.project) {
            sections.push(`- Projects: ${byType.project.join(', ')}`);
        }
        if (byType.term) {
            sections.push(`- Terms: ${byType.term.join(', ')}`);
        }
        if (byType.company) {
            sections.push(`- Companies: ${byType.company.join(', ')}`);
        }
        
        return sections.join('\n');
    }

    /**
     * Resolve entity prediction to full entity details
     * 
     * Looks up the entity in the context system to get display name and type.
     * Returns null if entity is not found in context.
     * 
     * @param pred - Entity prediction from weight model
     * @returns Resolved entity or null
     */
    private resolvePredictionToEntity(
        pred: EntityPrediction
    ): EntityPrepositioningGuidance['likelyEntities'][0] | null {
        // Try each entity type getter
        const person = this.contextInstance.getPerson(pred.entityId);
        if (person) {
            const confidence = pred.score > 10 ? 'high' : pred.score > 5 ? 'medium' : 'low';
            return {
                id: pred.entityId,
                name: person.name,
                type: 'person',
                confidence
            };
        }
        
        const project = this.contextInstance.getProject(pred.entityId);
        if (project) {
            const confidence = pred.score > 10 ? 'high' : pred.score > 5 ? 'medium' : 'low';
            return {
                id: pred.entityId,
                name: project.name,
                type: 'project',
                confidence
            };
        }
        
        const term = this.contextInstance.getTerm(pred.entityId);
        if (term) {
            const confidence = pred.score > 10 ? 'high' : pred.score > 5 ? 'medium' : 'low';
            return {
                id: pred.entityId,
                name: term.name,
                type: 'term',
                confidence
            };
        }
        
        const company = this.contextInstance.getCompany(pred.entityId);
        if (company) {
            const confidence = pred.score > 10 ? 'high' : pred.score > 5 ? 'medium' : 'low';
            return {
                id: pred.entityId,
                name: company.name,
                type: 'company',
                confidence
            };
        }
        
        // Entity not found in context
        return null;
    }
}
