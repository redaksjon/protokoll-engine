/**
 * Report Generator
 *
 * Generates self-reflection reports in markdown or JSON format.
 */

import { 
    ReflectionReport, 
    ReflectionConfig, 
    TranscriptionMetrics, 
    ToolEffectiveness,
    QualityAssessment,
    Recommendation 
} from './types';
import * as Collector from './collector';
import * as fs from 'fs/promises';
import * as Logging from '../logging';

export interface ReporterInstance {
    generate(
        collector: Collector.CollectorInstance,
        audioFile: string,
        outputFile: string,
        conversationHistory?: unknown[],
        output?: string
    ): ReflectionReport;
  
    formatMarkdown(report: ReflectionReport): string;
    formatJson(report: ReflectionReport): string;
    save(report: ReflectionReport, path: string): Promise<void>;
}

export const create = (config: ReflectionConfig): ReporterInstance => {
    const logger = Logging.getLogger();
  
    const assessQuality = (
        metrics: TranscriptionMetrics,
        toolEffectiveness: ToolEffectiveness[]
    ): QualityAssessment => {
        // Calculate name accuracy based on resolution rate
        const nameAccuracy = metrics.unknownEntitiesFound > 0
            ? metrics.entitiesResolved / metrics.unknownEntitiesFound
            : 1.0;
    
        // Content preservation (should be close to 1.0)
        const contentPreservation = metrics.originalLength > 0
            ? Math.min(metrics.correctedLength / metrics.originalLength, 1.0)
            : 1.0;
    
        // Tool success rate
        const avgToolSuccess = toolEffectiveness.length > 0
            ? toolEffectiveness.reduce((sum, t) => sum + t.successRate, 0) / toolEffectiveness.length
            : 1.0;
    
        // Overall confidence
        const confidence = (nameAccuracy * 0.4) + (contentPreservation * 0.3) + (avgToolSuccess * 0.3);
    
        return {
            confidence,
            nameAccuracy,
            routingConfidence: 0.9, // Would be calculated from routing decision
            contentPreservation,
            overallScore: confidence,
        };
    };
  
    const generateRecommendations = (
        metrics: TranscriptionMetrics,
        toolEffectiveness: ToolEffectiveness[],
        quality: QualityAssessment
    ): Recommendation[] => {
        const recommendations: Recommendation[] = [];
    
        // Check for tool failures
        const failedTools = toolEffectiveness.filter(t => t.successRate < 0.8);
        if (failedTools.length > 0) {
            recommendations.push({
                type: 'tool-issue',
                severity: 'high',
                message: `${failedTools.length} tool(s) had low success rates`,
                suggestion: `Review tool implementations: ${failedTools.map(t => t.name).join(', ')}`,
            });
        }
    
        // Check for unresolved entities
        if (metrics.unknownEntitiesFound > metrics.entitiesResolved) {
            const unresolved = metrics.unknownEntitiesFound - metrics.entitiesResolved;
            recommendations.push({
                type: 'context-gap',
                severity: 'medium',
                message: `${unresolved} entities could not be resolved`,
                suggestion: 'Run in interactive mode to add new context entries',
            });
        }
    
        // Check for high iteration count (real issue is usually unclear routing)
        if (metrics.iterations > 10) {
            recommendations.push({
                type: 'context-gap',
                severity: 'medium',
                message: `High iteration count (${metrics.iterations}) - model may be struggling to route this note`,
                suggestion: 'Add explicit trigger phrases to your project context files (e.g., "update on [project]")',
            });
        }
        
        // Only flag extremely long processing (> 5 minutes) as potential issue
        // Normal reasoning with gpt-5.2 can take 1-3 minutes and that's fine
        if (metrics.totalDuration > 300000) {  // > 5 minutes
            recommendations.push({
                type: 'performance',
                severity: 'low',
                message: `Processing took ${(metrics.totalDuration / 1000).toFixed(1)}s`,
                suggestion: 'Consider reviewing context files - unclear routing can cause excessive iterations',
            });
        }
    
        // Check content preservation
        if (quality.contentPreservation < 0.9) {
            recommendations.push({
                type: 'quality',
                severity: 'high',
                message: 'Significant content may have been lost',
                suggestion: 'Review prompt to ensure full content preservation',
            });
        }
    
        return recommendations;
    };
  
    const generate = (
        collector: Collector.CollectorInstance,
        audioFile: string,
        outputFile: string,
        conversationHistory?: unknown[],
        output?: string
    ): ReflectionReport => {
        const metrics = collector.getMetrics();
        const toolEffectiveness = collector.getToolEffectiveness();
        const contextChanges = collector.getContextChanges();
        const routingDecision = collector.getRoutingDecision();
        const quality = assessQuality(metrics, toolEffectiveness);
        const recommendations = generateRecommendations(metrics, toolEffectiveness, quality);
    
        return {
            id: `reflection-${Date.now()}`,
            generated: new Date(),
            audioFile,
            outputFile,
            summary: {
                duration: metrics.totalDuration,
                iterations: metrics.iterations,
                toolCalls: metrics.toolCallsExecuted,
                corrections: metrics.correctionsApplied,
                confidence: quality.confidence,
            },
            metrics,
            toolEffectiveness,
            quality,
            recommendations,
            routingDecision,
            contextChanges: contextChanges.length > 0 ? contextChanges : undefined,
            conversationHistory: config.includeConversation ? conversationHistory : undefined,
            output: config.includeOutput ? output : undefined,
        };
    };
  
    const formatMarkdown = (report: ReflectionReport): string => {
        let md = `# Protokoll - Self-Reflection Report\n\n`;
        md += `**Generated:** ${report.generated.toISOString()}\n`;
        md += `**Audio File:** ${report.audioFile}\n`;
        md += `**Output:** ${report.outputFile}\n\n`;
    
        md += `## Summary\n\n`;
        md += `- **Duration**: ${(report.summary.duration / 1000).toFixed(1)}s\n`;
        md += `- **Iterations**: ${report.summary.iterations}\n`;
        md += `- **Tool Calls**: ${report.summary.toolCalls}\n`;
        md += `- **Corrections**: ${report.summary.corrections}\n`;
        md += `- **Confidence**: ${(report.summary.confidence * 100).toFixed(1)}%\n\n`;
    
        md += `## Quality Assessment\n\n`;
        md += `- **Overall Score**: ${(report.quality.overallScore * 100).toFixed(1)}%\n`;
        md += `- **Name Accuracy**: ${(report.quality.nameAccuracy * 100).toFixed(1)}%\n`;
        md += `- **Content Preservation**: ${(report.quality.contentPreservation * 100).toFixed(1)}%\n`;
        md += `- **Routing Confidence**: ${(report.quality.routingConfidence * 100).toFixed(1)}%\n\n`;
    
        // Routing Decision with Reasoning
        if (report.routingDecision) {
            const rd = report.routingDecision;
            md += `## Routing Decision\n\n`;
            md += `**Project**: ${rd.projectId || '(default routing)'}\n`;
            md += `**Destination**: \`${rd.destination}\`\n`;
            md += `**Confidence**: ${(rd.confidence * 100).toFixed(1)}%\n\n`;
            
            md += `### Reasoning\n\n`;
            md += `${rd.reasoning}\n\n`;
            
            if (rd.signals && rd.signals.length > 0) {
                md += `### Classification Signals\n\n`;
                md += `| Signal Type | Value | Weight | Source |\n`;
                md += `|-------------|-------|--------|--------|\n`;
                for (const signal of rd.signals) {
                    const source = signal.source || '-';
                    md += `| ${signal.type} | "${signal.value}" | ${(signal.weight * 100).toFixed(0)}% | ${source} |\n`;
                }
                md += '\n';
            }
            
            if (rd.alternativesConsidered && rd.alternativesConsidered.length > 0) {
                md += `### Alternatives Considered\n\n`;
                for (const alt of rd.alternativesConsidered) {
                    md += `- **${alt.projectId}** (${(alt.confidence * 100).toFixed(1)}% confidence)\n`;
                    md += `  - Not chosen because: ${alt.whyNotChosen}\n`;
                }
                md += '\n';
            }
            
            if (rd.userConfirmed) {
                md += `*User confirmed this routing decision in interactive mode.*\n\n`;
            }
            
            if (rd.feedbackProvided) {
                md += `### Feedback Received\n\n`;
                md += `This routing was later corrected: ${rd.feedbackCorrection}\n\n`;
            }
        }
    
        if (report.toolEffectiveness.length > 0) {
            md += `## Tool Effectiveness\n\n`;
            md += `| Tool | Calls | Success | Failure | Success Rate | Avg Duration |\n`;
            md += `|------|-------|---------|---------|--------------|-------------|\n`;
      
            for (const tool of report.toolEffectiveness) {
                md += `| ${tool.name} | ${tool.callCount} | ${tool.successCount} | ${tool.failureCount} | `;
                md += `${(tool.successRate * 100).toFixed(1)}% | ${tool.avgDuration.toFixed(0)}ms |\n`;
            }
            md += '\n';
        }
    
        if (report.recommendations.length > 0) {
            md += `## Recommendations\n\n`;
      
            const bySeverity = {
                high: report.recommendations.filter(r => r.severity === 'high'),
                medium: report.recommendations.filter(r => r.severity === 'medium'),
                low: report.recommendations.filter(r => r.severity === 'low'),
            };
      
            if (bySeverity.high.length > 0) {
                md += `### 🔴 High Priority\n\n`;
                bySeverity.high.forEach((rec, i) => {
                    md += `${i + 1}. **${rec.message}**\n`;
                    if (rec.suggestion) md += `   - ${rec.suggestion}\n`;
                });
                md += '\n';
            }
      
            if (bySeverity.medium.length > 0) {
                md += `### 🟡 Medium Priority\n\n`;
                bySeverity.medium.forEach((rec, i) => {
                    md += `${i + 1}. **${rec.message}**\n`;
                    if (rec.suggestion) md += `   - ${rec.suggestion}\n`;
                });
                md += '\n';
            }
      
            if (bySeverity.low.length > 0) {
                md += `### 🟢 Low Priority\n\n`;
                bySeverity.low.forEach((rec, i) => {
                    md += `${i + 1}. **${rec.message}**\n`;
                    if (rec.suggestion) md += `   - ${rec.suggestion}\n`;
                });
                md += '\n';
            }
        }
    
        // Context changes section
        if (report.contextChanges && report.contextChanges.length > 0) {
            md += `## Context Changes\n\n`;
            md += `The following context entries were created or updated during this session:\n\n`;
            
            for (const change of report.contextChanges) {
                const emoji = change.action === 'created' ? '✨' : '📝';
                md += `${emoji} **${change.action.charAt(0).toUpperCase() + change.action.slice(1)} ${change.entityType}**: ${change.entityName}\n`;
                if (change.details) {
                    const details = change.details as Record<string, unknown>;
                    const routing = details.routing as Record<string, unknown> | undefined;
                    const destination = details.destination || routing?.destination;
                    if (destination) {
                        md += `   - Routing to: \`${destination}\`\n`;
                    }
                }
            }
            md += '\n';
        }
    
        md += `---\n\n`;
        md += `*Report generated by Protokoll Self-Reflection System*\n`;
    
        return md;
    };
  
    const formatJson = (report: ReflectionReport): string => {
        return JSON.stringify(report, null, 2);
    };
  
    const save = async (report: ReflectionReport, path: string): Promise<void> => {
        const content = config.format === 'markdown' 
            ? formatMarkdown(report)
            : formatJson(report);
    
        await fs.writeFile(path, content, 'utf-8');
        logger.info('Saved reflection report', { path });
    };
  
    return {
        generate,
        formatMarkdown,
        formatJson,
        save,
    };
};

