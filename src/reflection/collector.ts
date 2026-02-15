/**
 * Metrics Collector
 *
 * Collects metrics during transcription for self-reflection reporting.
 */

import { TranscriptionMetrics, ToolEffectiveness, ContextChange, RoutingDecisionRecord } from './types';
import * as Logging from '../logging';

export interface CollectorInstance {
    start(): void;
    recordWhisper(duration: number): void;
    recordToolCall(name: string, duration: number, success: boolean): void;
    recordCorrection(original: string, corrected: string): void;
    recordUnknownEntity(entity: string): void;
    recordResolvedEntity(entity: string, resolved: string): void;
    recordModelResponse(model: string, tokens: number): void;
    recordContextChange(change: ContextChange): void;
    recordRoutingDecision(decision: RoutingDecisionRecord): void;
    getMetrics(): TranscriptionMetrics;
    getToolEffectiveness(): ToolEffectiveness[];
    getContextChanges(): ContextChange[];
    getRoutingDecision(): RoutingDecisionRecord | undefined;
}

interface ToolStats {
    count: number;
    successCount: number;
    totalDuration: number;
}

export const create = (): CollectorInstance => {
    const logger = Logging.getLogger();
  
    let startTime: Date = new Date();
    let whisperDuration = 0;
    let iterations = 0;
    let originalLength = 0;
    let correctedLength = 0;
    let correctionsApplied = 0;
    let model = '';
    let tokensUsed = 0;
  
    const unknownEntities: string[] = [];
    const resolvedEntities: Map<string, string> = new Map();
    const toolCalls: Map<string, ToolStats> = new Map();
    const contextChanges: ContextChange[] = [];
    let routingDecision: RoutingDecisionRecord | undefined;
  
    const start = () => {
        startTime = new Date();
        logger.debug('Reflection collector started');
    };
  
    const recordWhisper = (duration: number) => {
        whisperDuration = duration;
    };
  
    const recordToolCall = (name: string, duration: number, success: boolean) => {
        iterations++;
    
        if (!toolCalls.has(name)) {
            toolCalls.set(name, { count: 0, successCount: 0, totalDuration: 0 });
        }
    
        const stats = toolCalls.get(name)!;
        stats.count++;
        stats.totalDuration += duration;
        if (success) {
            stats.successCount++;
        }
    };
  
    const recordCorrection = (original: string, corrected: string) => {
        if (originalLength === 0) {
            originalLength = original.length;
        }
        correctedLength = corrected.length;
        correctionsApplied++;
    };
  
    const recordUnknownEntity = (entity: string) => {
        unknownEntities.push(entity);
    };
  
    const recordResolvedEntity = (entity: string, resolved: string) => {
        resolvedEntities.set(entity, resolved);
    };
  
    const recordModelResponse = (m: string, tokens: number) => {
        model = m;
        tokensUsed += tokens;
    };
  
    const recordContextChange = (change: ContextChange) => {
        contextChanges.push(change);
        logger.info('Context change recorded: %s %s "%s"', change.action, change.entityType, change.entityName);
    };

    const getContextChanges = (): ContextChange[] => {
        return [...contextChanges];
    };

    const recordRoutingDecision = (decision: RoutingDecisionRecord) => {
        routingDecision = decision;
        logger.debug('Routing decision recorded: project=%s, confidence=%.1f%%', 
            decision.projectId || 'default', decision.confidence * 100);
    };

    const getRoutingDecision = (): RoutingDecisionRecord | undefined => {
        return routingDecision;
    };
  
    const getMetrics = (): TranscriptionMetrics => {
        const endTime = new Date();
        const totalDuration = endTime.getTime() - startTime.getTime();
        const reasoningDuration = totalDuration - whisperDuration;
    
        return {
            startTime,
            endTime,
            totalDuration,
            whisperDuration,
            reasoningDuration,
            iterations,
            toolCallsExecuted: Array.from(toolCalls.values()).reduce((sum, t) => sum + t.count, 0),
            toolsUsed: Array.from(toolCalls.keys()),
            originalLength,
            correctedLength,
            correctionsApplied,
            unknownEntitiesFound: unknownEntities.length,
            entitiesResolved: resolvedEntities.size,
            model,
            tokensUsed,
        };
    };
  
    const getToolEffectiveness = (): ToolEffectiveness[] => {
        return Array.from(toolCalls.entries()).map(([name, stats]) => ({
            name,
            callCount: stats.count,
            successCount: stats.successCount,
            failureCount: stats.count - stats.successCount,
            avgDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
            successRate: stats.count > 0 ? stats.successCount / stats.count : 0,
        }));
    };
  
    return {
        start,
        recordWhisper,
        recordToolCall,
        recordCorrection,
        recordUnknownEntity,
        recordResolvedEntity,
        recordModelResponse,
        recordContextChange,
        recordRoutingDecision,
        getMetrics,
        getToolEffectiveness,
        getContextChanges,
        getRoutingDecision,
    };
};

