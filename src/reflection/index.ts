/**
 * Self-Reflection System
 *
 * Main entry point for the self-reflection system. Provides metrics collection
 * and report generation for transcription quality analysis.
 */

import { ReflectionConfig, ReflectionReport } from './types';
import * as Collector from './collector';
import * as Reporter from './reporter';

export interface ReflectionInstance {
    collector: Collector.CollectorInstance;
    reporter: Reporter.ReporterInstance;
    generate(
        audioFile: string,
        outputFile: string,
        conversationHistory?: unknown[],
        output?: string
    ): ReflectionReport;
    save(report: ReflectionReport, path: string): Promise<void>;
}

export const create = (config: ReflectionConfig): ReflectionInstance => {
    const collector = Collector.create();
    const reporter = Reporter.create(config);
  
    return {
        collector,
        reporter,
        generate: (audioFile, outputFile, conversationHistory, output) => 
            reporter.generate(collector, audioFile, outputFile, conversationHistory, output),
        save: (report, path) => reporter.save(report, path),
    };
};

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
    enabled: false,
    format: 'markdown',
    includeConversation: false,
    includeOutput: true,
};

// Re-export types
export * from './types';

