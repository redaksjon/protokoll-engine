/**
 * Intelligent Classifier
 * 
 * Multi-signal classification system for routing transcripts to projects.
 * Uses various signals (explicit phrases, associated people/companies, topics)
 * to determine the best project match with confidence scoring.
 * 
 * Design Note: This module is designed to be self-contained and may be
 * extracted for use in other tools (kronologi, observasjon) in the future.
 */

import { 
    ClassificationResult, 
    ClassificationSignal, 
    ProjectRoute, 
    RoutingContext 
} from './types';
import * as Context from '../context';

export interface ClassifierInstance {
    classify(context: RoutingContext, routes: ProjectRoute[]): ClassificationResult[];
    calculateConfidence(signals: ClassificationSignal[]): number;
}

export const create = (contextInstance: Context.ContextInstance): ClassifierInstance => {
  
    const classify = (
        routingContext: RoutingContext, 
        routes: ProjectRoute[]
    ): ClassificationResult[] => {
        const results: ClassificationResult[] = [];
        const normalizedText = routingContext.transcriptText.toLowerCase();
    
        for (const route of routes) {
            if (route.active === false) continue;
      
            const signals: ClassificationSignal[] = [];
            const classification = route.classification;
      
            // 1. Check explicit phrases (highest weight)
            for (const phrase of classification.explicit_phrases ?? []) {
                if (normalizedText.includes(phrase.toLowerCase())) {
                    signals.push({
                        type: 'explicit_phrase',
                        value: phrase,
                        weight: 0.9,  // High confidence
                    });
                }
            }
      
            // 2. Check associated people
            const peopleInText = routingContext.detectedPeople ?? 
                detectPeopleFromContext(normalizedText, contextInstance);
      
            for (const personId of classification.associated_people ?? []) {
                if (peopleInText.includes(personId)) {
                    const person = contextInstance.getPerson(personId);
                    signals.push({
                        type: 'associated_person',
                        value: person?.name ?? personId,
                        weight: 0.6,
                    });
                }
            }
      
            // 3. Check associated companies
            const companiesInText = routingContext.detectedCompanies ?? 
                detectCompaniesFromContext(normalizedText, contextInstance);
      
            for (const companyId of classification.associated_companies ?? []) {
                if (companiesInText.includes(companyId)) {
                    const company = contextInstance.getCompany(companyId);
                    signals.push({
                        type: 'associated_company',
                        value: company?.name ?? companyId,
                        weight: 0.5,
                    });
                }
            }
      
            // 4. Check topics
            for (const topic of classification.topics ?? []) {
                if (normalizedText.includes(topic.toLowerCase())) {
                    signals.push({
                        type: 'topic',
                        value: topic,
                        weight: 0.3,
                    });
                }
            }
      
            // 5. Context type (if we can infer work vs personal)
            // This is a weaker signal but helps with disambiguation
            const inferredContextType = inferContextType(normalizedText);
            if (inferredContextType === classification.context_type) {
                signals.push({
                    type: 'context_type',
                    value: classification.context_type,
                    weight: 0.2,
                });
            }
      
            // Only include if we have at least one signal
            if (signals.length > 0) {
                const confidence = calculateConfidence(signals);
                results.push({
                    projectId: route.projectId,
                    confidence,
                    signals,
                    reasoning: buildReasoning(signals),
                });
            }
        }
    
        // Sort by confidence descending
        return results.sort((a, b) => b.confidence - a.confidence);
    };
  
    const calculateConfidence = (signals: ClassificationSignal[]): number => {
        if (signals.length === 0) return 0;
    
        // Weighted average with diminishing returns for multiple signals
        let totalWeight = 0;
        let weightedSum = 0;
    
        for (let i = 0; i < signals.length; i++) {
            const signal = signals[i];
            // Later signals contribute less (diminishing returns)
            const positionFactor = 1 / (1 + i * 0.3);
            const effectiveWeight = signal.weight * positionFactor;
      
            weightedSum += effectiveWeight;
            totalWeight += positionFactor;
        }
    
        // Normalize and cap at 0.99
        return Math.min(weightedSum / Math.max(totalWeight, 1), 0.99);
    };
  
    const buildReasoning = (signals: ClassificationSignal[]): string => {
        const parts = signals.map(s => {
            switch (s.type) {
                case 'explicit_phrase': return `explicit phrase: "${s.value}"`;
                case 'associated_person': return `mentioned ${s.value} (associated)`;
                case 'associated_company': return `mentioned ${s.value} (associated company)`;
                case 'topic': return `topic: ${s.value}`;
                case 'context_type': return `context: ${s.value}`;
            }
        });
        return parts.join(', ');
    };
  
    return { classify, calculateConfidence };
};

// Helper functions
function detectPeopleFromContext(
    text: string, 
    context: Context.ContextInstance
): string[] {
    const found: string[] = [];
  
    for (const person of context.getAllPeople()) {
        const nameNormalized = person.name.toLowerCase();
        if (text.includes(nameNormalized)) {
            found.push(person.id);
            continue;
        }
    
        // Check phonetic variants (sounds_like)
        for (const variant of person.sounds_like ?? []) {
            if (text.includes(variant.toLowerCase())) {
                found.push(person.id);
                break;
            }
        }
    }
  
    return found;
}

function detectCompaniesFromContext(
    text: string, 
    context: Context.ContextInstance
): string[] {
    const found: string[] = [];
  
    for (const company of context.getAllCompanies()) {
        const nameNormalized = company.name.toLowerCase();
        if (text.includes(nameNormalized)) {
            found.push(company.id);
            continue;
        }
    
        // Check full name
        if (company.fullName && text.includes(company.fullName.toLowerCase())) {
            found.push(company.id);
            continue;
        }
    
        // Check phonetic variants (sounds_like)
        for (const variant of company.sounds_like ?? []) {
            if (text.includes(variant.toLowerCase())) {
                found.push(company.id);
                break;
            }
        }
    }
  
    return found;
}

function inferContextType(text: string): 'work' | 'personal' | 'mixed' {
    const workIndicators = ['meeting', 'project', 'deadline', 'team', 'client', 'report'];
    const personalIndicators = ['family', 'weekend', 'vacation', 'hobby', 'friend'];
  
    let workScore = 0;
    let personalScore = 0;
  
    for (const word of workIndicators) {
        if (text.includes(word)) workScore++;
    }
  
    for (const word of personalIndicators) {
        if (text.includes(word)) personalScore++;
    }
  
    if (workScore > personalScore + 1) return 'work';
    if (personalScore > workScore + 1) return 'personal';
    return 'mixed';
}

