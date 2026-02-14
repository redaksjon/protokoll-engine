/**
 * Routing System
 * 
 * Main entry point for the routing system. Provides a factory function
 * to create routing instances that can classify transcripts and determine
 * output destinations using Dreadcabinet patterns.
 * 
 * Design Note: This module is designed to be self-contained and may be
 * extracted for use in other tools (kronologi, observasjon) in the future.
 */

import { RoutingConfig, RouteDecision, RoutingContext, RouteDestination, ProjectRoute } from './types';
import * as Router from './router';
import * as Classifier from './classifier';
import * as Context from '../context';

export interface RoutingInstance {
    route(context: RoutingContext): RouteDecision;
    buildOutputPath(decision: RouteDecision, context: RoutingContext): string;
    addProject(project: ProjectRoute): void;
    updateDefaultRoute(destination: RouteDestination): void;
    getConfig(): RoutingConfig;
}

export const create = (
    config: RoutingConfig,
    context: Context.ContextInstance
): RoutingInstance => {
    const classifier = Classifier.create(context);
    const router = Router.create(config, classifier);
  
    // Mutable config for self-update feature
    const currentConfig = { ...config };
  
    return {
        route: (ctx) => router.route(ctx),
        buildOutputPath: (decision, ctx) => router.buildOutputPath(decision, ctx),
    
        addProject: (project) => {
            currentConfig.projects.push(project);
        },
    
        updateDefaultRoute: (destination) => {
            currentConfig.default = destination;
        },
    
        getConfig: () => ({ ...currentConfig }),
    };
};

// Re-export types
export * from './types';

