/**
 * Pipeline Orchestrator
 *
 * Orchestrates the intelligent transcription pipeline, coordinating
 * all the modules: context, routing, transcription, reasoning,
 * agentic tools, interactive mode, output management, and reflection.
 * 
 * THIS IS THE MAIN PROCESSING FLOW - NOT DEAD CODE!
 */

import { PipelineConfig, PipelineInput, PipelineResult, PipelineState } from './types';
import * as Context from '@redaksjon/context';
import * as Routing from '../routing';
import * as Output from '../out';
import * as Reflection from '../reflection';
import * as Transcription from '../transcription';
import * as Reasoning from '../reasoning';
import * as Agentic from '../agentic';
import * as CompletePhase from '../phases/complete';
import * as SimpleReplace from '../phases/simple-replace';
import * as Logging from '../logging';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as Metadata from '../util/metadata';

export interface OrchestratorInstance {
    process(input: PipelineInput): Promise<PipelineResult>;
}

export interface OrchestratorConfig extends PipelineConfig {
    outputDirectory: string;
    outputStructure: string;
    outputFilenameOptions: string[];
    maxAudioSize: number;
    tempDirectory: string;
}

export const create = async (config: OrchestratorConfig): Promise<OrchestratorInstance> => {
    const logger = Logging.getLogger();
    const currentWorkingDir = globalThis.process.cwd();
  
    logger.debug('Initializing intelligent transcription pipeline...');
  
    // Initialize context system (async)
    // Prefer a pre-loaded context instance (required for GCS-backed storage);
    // otherwise create one from contextDirectory/contextDirectories.
    const context = config.contextInstance ?? await Context.create({
        startingDir: config.contextDirectory || currentWorkingDir,
        contextDirectories: config.contextDirectories,
    });
    logger.debug('Context system initialized - ready to query entities via tools');
  
    // Default routing configuration (used as fallback for projects without custom destination)
    const defaultPath = config.outputDirectory || '~/notes';
    const defaultStructure = (config.outputStructure || 'month') as Routing.FilesystemStructure;
    const defaultFilenameOptions = (config.outputFilenameOptions || ['date', 'time', 'subject']) as Routing.FilenameOption[];

    // Convert context projects to routing format
    // Projects without a destination inherit from the global default
    const contextProjects = context.getAllProjects();
    const routingProjects: Routing.ProjectRoute[] = contextProjects
        .filter(project => project.active !== false)
        .map(project => ({
            projectId: project.id,
            destination: {
                path: project.routing?.destination || defaultPath,
                structure: project.routing?.structure || defaultStructure,
                filename_options: project.routing?.filename_options || defaultFilenameOptions,
                createDirectories: true,
            },
            classification: project.classification,
            active: project.active,
            auto_tags: project.routing?.auto_tags,
        }));
    
    logger.debug('Loaded %d projects from context for routing', routingProjects.length);
  
    // Initialize routing with config-based defaults
    const routingConfig: Routing.RoutingConfig = {
        default: {
            path: defaultPath,
            structure: defaultStructure,
            filename_options: defaultFilenameOptions,
            createDirectories: true,
        },
        projects: routingProjects,
        conflict_resolution: 'primary',
    };
  
    const routing = Routing.create(routingConfig, context, config.weightModelProvider);
    logger.debug('Routing system initialized');
  
    // Interactive moved to protokoll-cli
    // const interactive = Interactive.create(
    //     { enabled: config.interactive, defaultToSuggestion: true, silent: config.silent },
    //     context
    // );
  
    const output = Output.create({
        intermediateDir: config.intermediateDir || './output/protokoll',
        keepIntermediates: config.keepIntermediates ?? true,
        timestampFormat: 'YYMMDD-HHmm',
    });
    logger.debug('Output manager initialized');
  
    const reflection = config.selfReflection 
        ? Reflection.create({
            enabled: true,
            format: 'markdown',
            includeConversation: false,
            includeOutput: true,
        })
        : null;
    if (reflection) {
        logger.debug('Self-reflection system enabled');
    }
  
    // Initialize transcription service
    const transcription = Transcription.create({
        defaultModel: config.transcriptionModel as Transcription.TranscriptionModel,
    });
    logger.debug('Transcription service initialized with model: %s', config.transcriptionModel);
  
    // Initialize reasoning for agentic processing
    const reasoning = Reasoning.create({ 
        model: config.model,
        reasoningLevel: config.reasoningLevel,
    });
    logger.debug('Reasoning system initialized with model: %s, reasoning level: %s', config.model, config.reasoningLevel || 'medium');

    // Initialize simple-replace phase for pre-LLM entity correction via sounds_like
    const simpleReplace = SimpleReplace.create({ debug: config.debug }, context);
    logger.debug('Simple-replace phase initialized with context instance');

    // Initialize complete phase for moving files to processed directory
    // Pass outputStructure so processed files use the same directory structure as output
    const complete = config.processedDirectory 
        ? CompletePhase.create({
            processedDirectory: config.processedDirectory,
            outputStructure: config.outputStructure as CompletePhase.FilesystemStructure,
            dryRun: config.dryRun,
        })
        : null;
    if (complete) {
        logger.debug('Complete phase initialized with processed directory: %s', config.processedDirectory);
    }
  
    // Helper to extract a human-readable title from the output path
    const extractTitleFromPath = (outputPath: string): string | undefined => {
        const filename = outputPath.split('/').pop()?.replace(/\.(md|pkl)$/, '');
        if (!filename) return undefined;
        
        // Remove date prefix (e.g., "27-0716-" from "27-0716-meeting-notes")
        const withoutDate = filename.replace(/^\d{2}-\d{4}-/, '');
        if (!withoutDate) return undefined;
        
        // Convert kebab-case to Title Case
        return withoutDate
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };
    
    // Helper to check if a title is meaningful (not just numbers/timestamps)
    const isMeaningfulTitle = (title: string | undefined): boolean => {
        if (!title) return false;
        // Reject UUID-like strings (hex characters separated by dashes, e.g. filenames from recordings)
        const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(title.trim())) return false;
        // Also reject if the title starts with a UUID segment pattern (Title Case converted UUID)
        const uuidSegmentPattern = /^[0-9a-f]{8}\s[0-9a-f]{4}\s/i;
        if (uuidSegmentPattern.test(title.trim())) return false;
        // Check if title is mostly numbers (timestamp-like) or very short fragments
        const stripped = title.replace(/\s+/g, '');
        const numberRatio = (stripped.match(/\d/g) || []).length / stripped.length;
        // Reject if: mostly numbers, too short, or common bad patterns
        if (numberRatio > 0.5) return false;
        if (stripped.length < 3) return false;
        // Reject titles that are just common words without context
        const badPatterns = /^(i|i have|i am|the|a|an|um|uh|so|well|okay|oh|hey|hi)$/i;
        if (badPatterns.test(title.trim())) return false;
        return true;
    };
    
    // Generate a meaningful title from transcript content using LLM
    const generateTitleFromContent = async (transcriptText: string, fallbackTitle?: string): Promise<string> => {
        try {
            // Use first ~2000 chars for title generation (enough context, not too expensive)
            const textSample = transcriptText.slice(0, 2000);
            
            const response = await reasoning.complete({
                systemPrompt: `You are a title generator. Given a transcript, generate a concise, descriptive title (3-8 words) that captures the main topic or theme.

Rules:
- Output ONLY the title, nothing else
- No quotes around the title
- Use Title Case
- Be specific - avoid generic titles like "Meeting Notes" or "Discussion"
- Focus on the main subject matter
- If there are multiple topics, pick the most prominent one`,
                prompt: `Generate a title for this transcript:\n\n${textSample}`,
            });
            
            // Clean up the response - remove quotes, trim whitespace
            const title = response.content
                .trim()
                .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
                .replace(/^#\s*/, '')          // Remove markdown heading prefix
                .trim();
            
            // Validate the generated title
            if (title && title.length > 0 && title.length < 100) {
                logger.debug('Generated title from content: %s', title);
                return title;
            }
            
            logger.debug('Generated title was invalid, using fallback');
            return fallbackTitle || 'Untitled';
        } catch (error) {
            logger.warn('Title generation failed, using fallback', { error });
            return fallbackTitle || 'Untitled';
        }
    };

    const processInput = async (input: PipelineInput): Promise<PipelineResult> => {
        const startTime = Date.now();
        
        // Format progress prefix for log messages
        const progressPrefix = input.progress 
            ? `[${input.progress.current}/${input.progress.total}]` 
            : '';
        const log = (level: 'info' | 'debug', message: string, ...args: unknown[]) => {
            const prefixedMessage = progressPrefix ? `${progressPrefix} ${message}` : message;
            if (level === 'info') {
                logger.info(prefixedMessage, ...args);
            } else {
                logger.debug(prefixedMessage, ...args);
            }
        };
    
        log('info', 'Processing: %s (hash: %s)', input.audioFile, input.hash);
    
        // Initialize state
        const state: PipelineState = {
            input,
            startTime: new Date(),
        };
    
        // Start reflection collection if enabled
        if (reflection) {
            reflection.collector.start();
        }
    
        // Start interactive session if enabled
        // Interactive moved to protokoll-cli
        // if (config.interactive) {
        //     interactive.startSession();
        //     log('debug', 'Interactive session started');
        // }
    
        try {
            // Step 1: Check onboarding needs (moved to protokoll-cli)
            log('debug', 'Checking onboarding state...');
            // const onboardingState = interactive.checkNeedsOnboarding();
            const onboardingState = { needsOnboarding: false }; // Stub
            if (onboardingState.needsOnboarding) {
                log('debug', 'First-run detected - onboarding may be triggered');
            }
      
            // Step 2: Raw transcription using Transcription module
            log('info', 'Transcribing audio...');
            const whisperStart = Date.now();
            
            const transcriptionResult = await transcription.transcribe(input.audioFile, {
                model: config.transcriptionModel as Transcription.TranscriptionModel,
            });
            state.rawTranscript = transcriptionResult.text;
            
            const whisperDuration = Date.now() - whisperStart;
            log('info', 'Transcription: %d chars in %.1fs', 
                state.rawTranscript.length, whisperDuration / 1000);
      
            if (reflection) {
                reflection.collector.recordWhisper(whisperDuration);
            }
      
            // Step 3: Route detection
            log('debug', 'Determining routing destination...');
            const routingContext: Routing.RoutingContext = {
                transcriptText: state.rawTranscript || '',
                audioDate: input.creation,
                sourceFile: input.audioFile,
                hash: input.hash,
            };
      
            const routeResult = routing.route(routingContext);
      
            log('debug', 'Routing decision: project=%s, confidence=%.2f', 
                routeResult.projectId || 'default', routeResult.confidence);
      
            // Record routing decision in reflection
            if (reflection) {
                reflection.collector.recordRoutingDecision({
                    projectId: routeResult.projectId,
                    destination: routeResult.destination.path,
                    confidence: routeResult.confidence,
                    reasoning: routeResult.reasoning,
                    signals: routeResult.signals.map(s => ({
                        type: s.type,
                        value: s.value,
                        weight: s.weight,
                    })),
                    alternativesConsidered: routeResult.alternateMatches?.map(alt => ({
                        projectId: alt.projectId,
                        confidence: alt.confidence,
                        whyNotChosen: `Lower confidence (${(alt.confidence * 100).toFixed(1)}%)`,
                    })),
                });
            }
      
            // Build output path
            const outputPath = routing.buildOutputPath(routeResult, routingContext);
            log('debug', 'Output path: %s', outputPath);
      
            // Step 4: Create output paths using Output module
            log('debug', 'Setting up output directories...');
            const paths = output.createOutputPaths(
                input.audioFile,
                outputPath,
                input.hash,
                input.creation
            );
      
            await output.ensureDirectories(paths);
            
            // Write raw transcript to intermediate (for debugging)
            await output.writeIntermediate(paths, 'transcript', {
                text: state.rawTranscript,
                model: config.transcriptionModel,
                duration: whisperDuration,
            });

            // Step 4b: Simple-replace phase — sounds_like entity correction before LLM
            // Matches entity names (projects, people, terms) using sounds_like mappings,
            // corrects them in the transcript text, and tracks which entities were found.
            log('debug', 'Running simple-replace (sounds_like entity matching)...');
            // Derive the intermediate directory from an existing intermediate file path
            const intermediateDir = path.dirname(paths.intermediate.transcript);
            const simpleReplaceResult = await simpleReplace.replace(
                state.rawTranscript || '',
                {
                    project: routeResult.projectId ?? undefined,
                    confidence: routeResult.confidence,
                },
                intermediateDir,
                input.hash
            );

            if (simpleReplaceResult.replacementsMade) {
                log('info',
                    'Simple-replace: %d correction(s) applied (%d Tier-1, %d Tier-2)',
                    simpleReplaceResult.stats.totalReplacements,
                    simpleReplaceResult.stats.tier1Replacements,
                    simpleReplaceResult.stats.tier2Replacements
                );
                // Write the corrected text to intermediate for inspection
                await output.writeIntermediate(paths, 'session', {
                    simpleReplace: {
                        replacementsMade: true,
                        stats: simpleReplaceResult.stats,
                    },
                });
            } else {
                log('debug', 'Simple-replace: no replacements made');
            }

            // Notify caller (e.g. worker) so it can write to the PKL enhancement log
            input.onSimpleReplaceComplete?.(simpleReplaceResult.stats);

            // Collect pre-identified entities from simple-replace applied mappings
            const preIdentifiedEntities: Agentic.ToolContext['preIdentifiedEntities'] = {
                people: new Set<string>(),
                projects: new Set<string>(),
                terms: new Set<string>(),
                companies: new Set<string>(),
            };
            for (const mapping of simpleReplaceResult.stats.appliedMappings) {
                if (!mapping.entityId || !mapping.entityType) continue;
                if (mapping.entityType === 'person') preIdentifiedEntities.people.add(mapping.entityId);
                else if (mapping.entityType === 'project') preIdentifiedEntities.projects.add(mapping.entityId);
                else if (mapping.entityType === 'term') preIdentifiedEntities.terms.add(mapping.entityId);
                else if (mapping.entityType === 'company') preIdentifiedEntities.companies.add(mapping.entityId);
            }
      
            // Step 5: Agentic enhancement using real executor
            // The LLM receives the already-corrected text (simple-replace output)
            // and is told which entities were pre-matched so it doesn't re-lookup them.
            log('info', 'Enhancing with %s...', config.model);
            
            const agenticStart = Date.now();
            const toolContext: Agentic.ToolContext = {
                transcriptText: simpleReplaceResult.text,
                audioDate: input.creation,
                sourceFile: input.audioFile,
                contextInstance: context,
                routingInstance: routing,
                preIdentifiedEntities,
                interactiveMode: config.interactive,
                // Interactive moved to protokoll-cli
                // interactiveInstance: interactive,
                weightModelProvider: config.weightModelProvider,
                onToolCallStart: input.onToolCallStart,
                onToolCallComplete: input.onToolCallComplete,
            };
            
            const executor = Agentic.create(reasoning, toolContext);
            const agenticResult = await executor.process(simpleReplaceResult.text);
            
            state.enhancedText = agenticResult.enhancedText;
            const toolsUsed = agenticResult.toolsUsed;
            const agenticDuration = Date.now() - agenticStart;
            
            // Record tool calls in reflection
            if (reflection) {
                for (const tool of toolsUsed) {
                    reflection.collector.recordToolCall(tool, agenticDuration / toolsUsed.length, true);
                }
                reflection.collector.recordCorrection(state.rawTranscript || '', state.enhancedText);
                // Record token usage from agentic result
                if (agenticResult.totalTokens) {
                    reflection.collector.recordModelResponse(config.model, agenticResult.totalTokens);
                }
                // Record context changes (new projects, entities created)
                if (agenticResult.contextChanges) {
                    for (const change of agenticResult.contextChanges) {
                        reflection.collector.recordContextChange(change);
                    }
                }
            }
            
            // Write agentic session to intermediate
            await output.writeIntermediate(paths, 'session', {
                iterations: agenticResult.iterations,
                toolsUsed: agenticResult.toolsUsed,
                state: agenticResult.state,
            });
      
            // Step 5b: Check if agentic processing found a different route
            // (e.g., via lookup_project tool finding a project with custom destination)
            if (agenticResult.state.routeDecision?.destination?.path) {
                const agenticRoute = agenticResult.state.routeDecision;
                log('debug', 'Agentic processing found route: %s -> %s', 
                    agenticRoute.projectId || 'unknown', 
                    agenticRoute.destination.path
                );
                
                // Update routeResult with the agentic decision
                routeResult.projectId = agenticRoute.projectId || routeResult.projectId;
                routeResult.destination = {
                    ...routeResult.destination,
                    path: agenticRoute.destination.path,
                    structure: agenticRoute.destination.structure || routeResult.destination.structure,
                };
                routeResult.confidence = agenticRoute.confidence || routeResult.confidence;
                routeResult.reasoning = agenticRoute.reasoning || routeResult.reasoning;
                if (agenticRoute.signals) {
                    routeResult.signals = agenticRoute.signals;
                }
                
                // Rebuild output path with the new destination
                const newOutputPath = routing.buildOutputPath(routeResult, routingContext);
                log('debug', 'Updated output path: %s -> %s', outputPath, newOutputPath);
                
                // Recreate output paths with new destination
                const newPaths = output.createOutputPaths(
                    input.audioFile,
                    newOutputPath,
                    input.hash,
                    input.creation
                );
                await output.ensureDirectories(newPaths);
                
                // Update paths reference (reassign properties since paths is const)
                Object.assign(paths, newPaths);
            }

            // Step 5c: Write raw transcript to .transcript/ directory alongside final output
            // This is done AFTER the route is finalized so it goes to the correct location
            // Enables compare and reanalyze workflows
            log('debug', 'Writing raw transcript to .transcript/ directory...');
            await output.writeRawTranscript(paths, {
                text: state.rawTranscript,
                model: config.transcriptionModel,
                duration: whisperDuration,
                audioFile: input.audioFile,
                audioHash: input.hash,
                transcribedAt: new Date().toISOString(),
            });

            // Step 6: Write final output using Output module with metadata
            log('debug', 'Writing final transcript...');
            let finalTitle: string | undefined;
            let finalEntities: Metadata.TranscriptMetadata['entities'] | undefined;
            if (state.enhancedText) {
                // Build entity metadata from referenced entities
                const buildEntityReferences = (): Metadata.TranscriptMetadata['entities'] => {
                    const refs = agenticResult.state.referencedEntities;
                    if (!refs) return undefined;
                    
                    const entities: NonNullable<Metadata.TranscriptMetadata['entities']> = {
                        people: [],
                        projects: [],
                        terms: [],
                        companies: [],
                    };
                    
                    for (const personId of refs.people) {
                        if (!personId) continue;
                        const person = context.getPerson(personId);
                        if (person) {
                            entities.people!.push({ id: person.id, name: person.name, type: 'person' });
                        }
                    }
                    
                    for (const projectId of refs.projects) {
                        if (!projectId) continue;
                        const project = context.getProject(projectId);
                        if (project) {
                            entities.projects!.push({ id: project.id, name: project.name, type: 'project' });
                        }
                    }
                    
                    for (const termId of refs.terms) {
                        if (!termId) continue;
                        const term = context.getTerm(termId);
                        if (term) {
                            entities.terms!.push({ id: term.id, name: term.name, type: 'term' });
                        }
                    }
                    
                    for (const companyId of refs.companies) {
                        if (!companyId) continue;
                        const company = context.getCompany(companyId);
                        if (company) {
                            entities.companies!.push({ id: company.id, name: company.name, type: 'company' });
                        }
                    }
                    
                    // Only return if we found any entities
                    const hasEntities = 
                        entities.people!.length > 0 ||
                        entities.projects!.length > 0 ||
                        entities.terms!.length > 0 ||
                        entities.companies!.length > 0;
                    
                    return hasEntities ? entities : undefined;
                };
                
                // Generate title - prefer path-derived title if meaningful, otherwise use LLM
                const pathTitle = extractTitleFromPath(paths.final);
                let title: string;
                if (isMeaningfulTitle(pathTitle)) {
                    title = pathTitle!;
                } else {
                    log('debug', 'Path-derived title not meaningful (%s), generating from content...', pathTitle || 'empty');
                    title = await generateTitleFromContent(state.enhancedText, pathTitle);
                    log('info', 'Generated title: %s', title);
                    
                    // Rebuild output path with the generated title as the subject
                    // This ensures the filename matches the title
                    const contextWithTitle: Routing.RoutingContext = {
                        ...routingContext,
                        subjectOverride: title,
                    };
                    const newOutputPath = routing.buildOutputPath(routeResult, contextWithTitle);
                    
                    if (newOutputPath !== paths.final) {
                        log('debug', 'Updating output path with generated title: %s -> %s', paths.final, newOutputPath);
                        
                        // Recreate output paths with the new filename
                        const newPaths = output.createOutputPaths(
                            input.audioFile,
                            newOutputPath,
                            input.hash,
                            input.creation
                        );
                        await output.ensureDirectories(newPaths);
                        
                        // Update paths reference
                        Object.assign(paths, newPaths);
                    }
                }
                
                // Generate UUID for this transcript
                const transcriptUuid = randomUUID();
                
                // Build metadata from routing decision and input
                const transcriptMetadata: Metadata.TranscriptMetadata = {
                    id: transcriptUuid,
                    title,
                    projectId: routeResult.projectId || undefined,
                    project: routeResult.projectId ? (context.getProject(routeResult.projectId)?.name || undefined) : undefined,
                    date: input.creation,
                    routing: Metadata.createRoutingMetadata(routeResult),
                    tags: Metadata.extractTagsFromSignals(routeResult.signals),
                    confidence: routeResult.confidence,
                    entities: buildEntityReferences(),
                };
                
                await output.writeTranscript(paths, state.enhancedText, transcriptMetadata);
                finalTitle = title;
                finalEntities = transcriptMetadata.entities;
                
                // Notify weight model of entity updates (if callback provided)
                if (config.onTranscriptEntitiesUpdated && transcriptMetadata.entities) {
                    const allEntityIds: string[] = [];
                    if (transcriptMetadata.entities.people) {
                        allEntityIds.push(...transcriptMetadata.entities.people.map(e => e.id));
                    }
                    if (transcriptMetadata.entities.projects) {
                        allEntityIds.push(...transcriptMetadata.entities.projects.map(e => e.id));
                    }
                    if (transcriptMetadata.entities.terms) {
                        allEntityIds.push(...transcriptMetadata.entities.terms.map(e => e.id));
                    }
                    if (transcriptMetadata.entities.companies) {
                        allEntityIds.push(...transcriptMetadata.entities.companies.map(e => e.id));
                    }
                    
                    config.onTranscriptEntitiesUpdated(
                        transcriptUuid,
                        allEntityIds,
                        routeResult.projectId || undefined
                    );
                }
            }
      
            // Step 7: Generate reflection report
            log('debug', 'Generating reflection report...');
            let reflectionReport: Reflection.ReflectionReport | undefined;
            if (reflection) {
                reflectionReport = reflection.generate(
                    input.audioFile,
                    paths.final,
                    undefined,
                    state.enhancedText
                );
        
                if (paths.intermediate.reflection) {
                    await reflection.save(reflectionReport, paths.intermediate.reflection);
                }
            }
      
            // Step 8: End interactive session (moved to protokoll-cli)
            log('debug', 'Finalizing session...');
            // let session: Interactive.InteractiveSession | undefined;
            // if (config.interactive) {
            //     session = interactive.endSession();
            //     log('debug', 'Interactive session ended: %d clarifications', session.responses.length);
            //     // Save session if path available
            //     if (paths.intermediate.session) {
            //         await output.writeIntermediate(paths, 'session', session);
            //     }
            // }
      
            // Step 9: Cleanup if needed
            if (!config.keepIntermediates && !config.debug) {
                await output.cleanIntermediates(paths);
            }

            // Step 10: Move audio file to processed directory
            let processedAudioPath: string | undefined;
            if (complete) {
                // Extract subject from output path for naming
                const subject = paths.final.split('/').pop()?.replace('.md', '') || undefined;
                processedAudioPath = await complete.complete(
                    input.audioFile, 
                    input.hash, 
                    input.creation,
                    subject
                );
            }
      
            const processingTime = Date.now() - startTime;
      
            // Compact summary output
            log('info', 'Enhancement: %d iterations, %d tools, %.1fs', 
                agenticResult.iterations, toolsUsed.length, agenticDuration / 1000);
            if (agenticResult.totalTokens) {
                log('info', 'Tokens: %d total', agenticResult.totalTokens);
            }
            log('info', 'Output: %s (%.1fs total)', paths.final, processingTime / 1000);
      
            return {
                outputPath: paths.final,
                enhancedText: state.enhancedText || '',
                rawTranscript: state.rawTranscript || '',
                title: finalTitle || '',
                routedProject: routeResult.projectId,
                routedProjectName: routeResult.projectId ? (context.getProject(routeResult.projectId)?.name || null) : null,
                routingConfidence: routeResult.confidence,
                entities: finalEntities,
                processingTime,
                toolsUsed,
                correctionsApplied: agenticResult.state.resolvedEntities.size,
                processedAudioPath,
                reflection: reflectionReport,
                // session, // Interactive moved to protokoll-cli
                intermediatePaths: paths,
            };
      
        } catch (error) {
            logger.error('Pipeline error', { error });
            throw error;
        }
    };
  
    return { process: processInput };
};
