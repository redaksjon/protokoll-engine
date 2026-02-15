/**
 * Resilient Entity Finder
 * 
 * Provides case-insensitive and fuzzy matching for all entity types.
 * Handles typos, capitalization differences, and matches by both ID and name.
 */

import * as Context from '@redaksjon/context';
import type { Entity, Person, Project, Company, Term, IgnoredTerm } from '@redaksjon/context';

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed to transform str1 into str2
 */
function levenshteinDistance(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    if (s1 === s2) return 0;
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;
    
    const matrix: number[][] = [];
    
    // Initialize first row and column
    for (let i = 0; i <= s2.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill the matrix
    for (let i = 1; i <= s2.length; i++) {
        for (let j = 1; j <= s1.length; j++) {
            if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[s2.length][s1.length];
}

/**
 * Calculate similarity score (0-1) based on Levenshtein distance
 * 1.0 = identical, 0.0 = completely different
 */
function similarityScore(str1: string, str2: string): number {
    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;
    return 1 - (distance / maxLength);
}

interface EntityMatch<T extends Entity> {
    entity: T;
    score: number;
    matchType: 'exact_id' | 'exact_name' | 'fuzzy_id' | 'fuzzy_name';
}

/**
 * Generic resilient entity finder
 * Works for any entity type that has id and name properties
 */
function findEntityResilient<T extends Entity>(
    allEntities: T[],
    query: string,
    entityTypeName: string
): T {
    const queryLower = query.toLowerCase();
    const matches: EntityMatch<T>[] = [];
    
    for (const entity of allEntities) {
        const idLower = entity.id.toLowerCase();
        const nameLower = entity.name.toLowerCase();
        
        // 1. Exact ID match
        if (idLower === queryLower) {
            return entity; // Return immediately for exact match
        }
        
        // 2. Exact name match
        if (nameLower === queryLower) {
            matches.push({ entity, score: 1.0, matchType: 'exact_name' });
            continue;
        }
        
        // 3. Fuzzy ID match
        const idSimilarity = similarityScore(query, entity.id);
        if (idSimilarity >= 0.7) {
            matches.push({ entity, score: idSimilarity, matchType: 'fuzzy_id' });
        }
        
        // 4. Fuzzy name match
        const nameSimilarity = similarityScore(query, entity.name);
        if (nameSimilarity >= 0.7) {
            matches.push({ entity, score: nameSimilarity, matchType: 'fuzzy_name' });
        }
    }
    
    // If we found matches, return the best one
    if (matches.length > 0) {
        matches.sort((a, b) => {
            // Prefer exact matches over fuzzy
            if (a.matchType === 'exact_name' && b.matchType !== 'exact_name') return -1;
            if (b.matchType === 'exact_name' && a.matchType !== 'exact_name') return 1;
            // Then sort by score
            return b.score - a.score;
        });
        return matches[0].entity;
    }
    
    // No match found - build helpful error message
    const entityList = allEntities
        .map(e => `  - ${e.id} (${e.name})`)
        .join('\n');
    
    throw new Error(
        `${entityTypeName} not found: "${query}"\n\n` +
        `Available ${entityTypeName.toLowerCase()}s:\n${entityList}\n\n` +
        `Note: Matching is case-insensitive and supports fuzzy matching. ` +
        `Try using the ${entityTypeName.toLowerCase()} ID or name exactly as shown above.`
    );
}

/**
 * Find a project using resilient matching
 */
export function findProjectResilient(
    context: Context.ContextInstance,
    query: string
): Project {
    const allProjects = context.getAllProjects();
    return findEntityResilient(allProjects, query, 'Project');
}

/**
 * Find a person using resilient matching
 */
export function findPersonResilient(
    context: Context.ContextInstance,
    query: string
): Person {
    const allPeople = context.getAllPeople();
    return findEntityResilient(allPeople, query, 'Person');
}

/**
 * Find a company using resilient matching
 */
export function findCompanyResilient(
    context: Context.ContextInstance,
    query: string
): Company {
    const allCompanies = context.getAllCompanies();
    return findEntityResilient(allCompanies, query, 'Company');
}

/**
 * Find a term using resilient matching
 */
export function findTermResilient(
    context: Context.ContextInstance,
    query: string
): Term {
    const allTerms = context.getAllTerms();
    return findEntityResilient(allTerms, query, 'Term');
}

/**
 * Find an ignored term using resilient matching
 */
export function findIgnoredResilient(
    context: Context.ContextInstance,
    query: string
): IgnoredTerm {
    const allIgnored = context.getAllIgnored();
    return findEntityResilient(allIgnored, query, 'Ignored term');
}
