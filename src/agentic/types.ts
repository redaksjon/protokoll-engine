/**
 * Agentic Transcription Types
 *
 * Types for tool-based transcription enhancement.
 * Includes Zod schemas for validation and documentation.
 */

import { z } from 'zod';
import * as Context from '../context';
import * as Routing from '../routing';

// ============================================================================
// Zod Schemas for Structured Outputs
// ============================================================================

/**
 * Schema for a corrected entity (spelling/name correction)
 */
export const CorrectedEntitySchema = z.object({
    original: z.string().describe('Original text from transcript'),
    corrected: z.string().describe('Corrected spelling/name'),
    type: z.enum(['person', 'project', 'term', 'company']).describe('Entity type'),
    confidence: z.number().min(0).max(1).describe('Confidence in correction'),
});

export type CorrectedEntity = z.infer<typeof CorrectedEntitySchema>;

/**
 * Schema for routing decision
 * Note: Uses the existing ClassificationSignal types from routing/types.ts
 */
export const RoutingDecisionSchema = z.object({
    projectId: z.string().optional().describe('Matched project ID'),
    destination: z.object({
        path: z.string().describe('File destination path'),
        structure: z.enum(['none', 'year', 'month', 'day']).default('month'),
    }),
    confidence: z.number().min(0).max(1).describe('Confidence in routing'),
    signals: z.array(z.object({
        type: z.enum(['explicit_phrase', 'associated_person', 'associated_company', 'topic', 'context_type']),
        value: z.string(),
        weight: z.number(),
    })).optional(),
    reasoning: z.string().optional().describe('Why this destination was chosen'),
});

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

/**
 * Schema for referenced entities
 */
export const ReferencedEntitiesSchema = z.object({
    people: z.array(z.string()).describe('IDs of people mentioned'),
    projects: z.array(z.string()).describe('IDs of projects mentioned'),
    terms: z.array(z.string()).describe('IDs of terms mentioned'),
    companies: z.array(z.string()).describe('IDs of companies mentioned'),
});

export type ReferencedEntitiesOutput = z.infer<typeof ReferencedEntitiesSchema>;

/**
 * Schema for tool result data
 */
export const ToolResultSchema = z.object({
    success: z.boolean(),
    data: z.any().optional(),
    error: z.string().optional(),
    needsUserInput: z.boolean().optional(),
    userPrompt: z.string().optional(),
});

// ============================================================================
// TypeScript Interfaces (existing, preserved for compatibility)
// ============================================================================

export interface TranscriptionTool {
    name: string;
    description: string;
     
    parameters: Record<string, any>;  // JSON Schema
     
    execute: (args: any) => Promise<ToolResult>;
}

export interface ToolContext {
    transcriptText: string;
    audioDate: Date;
    sourceFile: string;
    contextInstance: Context.ContextInstance;
    routingInstance: Routing.RoutingInstance;
    interactiveMode: boolean;
    // interactiveInstance?: Interactive.InteractiveInstance; // Interactive moved to protokoll-cli
    resolvedEntities?: Map<string, string>;  // Entities resolved during this session
}

export interface ToolResult {
    success: boolean;
     
    data?: any;
    error?: string;
    needsUserInput?: boolean;
    userPrompt?: string;
}

export interface ReferencedEntity {
    id: string;
    name: string;
    type: 'person' | 'project' | 'term' | 'company';
}

export interface TranscriptionState {
    originalText: string;
    correctedText: string;
    unknownEntities: string[];
    resolvedEntities: Map<string, string>;  // name mapping (old -> new)
     
    routeDecision?: RoutingDecision;
    confidence: number;
    
    // Track all entities referenced during processing
    referencedEntities: {
        people: Set<string>;      // IDs of people mentioned
        projects: Set<string>;    // IDs of projects mentioned
        terms: Set<string>;       // IDs of terms mentioned
        companies: Set<string>;   // IDs of companies mentioned
    };
}

