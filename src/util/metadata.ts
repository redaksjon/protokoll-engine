import * as Routing from '@/routing';

// ============================================================================
// Lifecycle Types
// ============================================================================

/**
 * Transcript lifecycle status
 * - initial: Whisper transcription complete
 * - enhanced: Context-aware enhancement complete
 * - reviewed: User has reviewed the transcript
 * - in_progress: Has outstanding tasks to complete
 * - closed: All work complete, no pending tasks
 * - archived: Archived for long-term storage
 */
export type TranscriptStatus = 'initial' | 'enhanced' | 'reviewed' | 'in_progress' | 'closed' | 'archived';

/**
 * Record of a status transition with timestamp
 */
export interface StatusTransition {
    from: TranscriptStatus;
    to: TranscriptStatus;
    at: string; // ISO 8601 timestamp
}

/**
 * A follow-up task associated with a transcript
 */
export interface Task {
    id: string; // generated unique ID (e.g., task-1234567890-abc123)
    description: string;
    status: 'open' | 'done';
    created: string; // ISO 8601 timestamp
    changed?: string; // ISO 8601 timestamp - when last modified
    completed?: string; // ISO 8601 timestamp - when marked done
}

// ============================================================================
// Entity Types
// ============================================================================

export interface EntityReference {
    id: string;
    name: string;
    type: 'person' | 'project' | 'term' | 'company';
}

export interface TranscriptMetadata {
    // Core fields
    title?: string;
    project?: string;
    projectId?: string;
    routing?: RoutingMetadata;
    tags?: string[];
    date?: Date;
    recordingTime?: string;
    confidence?: number;
    duration?: string;
    
    // Lifecycle fields
    status?: TranscriptStatus;
    history?: StatusTransition[];
    tasks?: Task[];
    
    // Entity references - entities mentioned/used in this transcript
    entities?: {
        people?: EntityReference[];
        projects?: EntityReference[];
        terms?: EntityReference[];
        companies?: EntityReference[];
    };
}

export interface RoutingMetadata {
    destination: string;
    confidence: number;
    signals: Routing.ClassificationSignal[];
    reasoning: string;
}

/**
 * Format metadata as Markdown heading section
 */
export const formatMetadataMarkdown = (metadata: TranscriptMetadata): string => {
    const lines: string[] = [];
    
    // Title section
    if (metadata.title) {
        lines.push(`# ${metadata.title}`);
        lines.push('');
    }
    
    // Metadata frontmatter as readable markdown
    lines.push('## Metadata');
    lines.push('');
    
    // Date and Time
    if (metadata.date) {
        const dateStr = metadata.date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        lines.push(`**Date**: ${dateStr}`);
        
        if (metadata.recordingTime) {
            lines.push(`**Time**: ${metadata.recordingTime}`);
        } else {
            const timeStr = metadata.date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            lines.push(`**Time**: ${timeStr}`);
        }
    }
    
    lines.push('');
    
    // Project
    if (metadata.project) {
        lines.push(`**Project**: ${metadata.project}`);
        if (metadata.projectId) {
            lines.push(`**Project ID**: \`${metadata.projectId}\``);
        }
        lines.push('');
    }
    
    // Routing Information
    if (metadata.routing) {
        lines.push('### Routing');
        lines.push('');
        lines.push(`**Destination**: ${metadata.routing.destination}`);
        lines.push(`**Confidence**: ${(metadata.routing.confidence * 100).toFixed(1)}%`);
        lines.push('');
        
        if (metadata.routing.signals.length > 0) {
            lines.push('**Classification Signals**:');
            for (const signal of metadata.routing.signals) {
                const signalType = signal.type.replace(/_/g, ' ');
                const weight = (signal.weight * 100).toFixed(0);
                lines.push(`- ${signalType}: "${signal.value}" (${weight}% weight)`);
            }
            lines.push('');
        }
        
        if (metadata.routing.reasoning) {
            lines.push(`**Reasoning**: ${metadata.routing.reasoning}`);
            lines.push('');
        }
    }
    
    // Tags
    if (metadata.tags && metadata.tags.length > 0) {
        lines.push('**Tags**: ' + metadata.tags.map(tag => `\`${tag}\``).join(', '));
        lines.push('');
    }
    
    // Duration
    if (metadata.duration) {
        lines.push(`**Duration**: ${metadata.duration}`);
        lines.push('');
    }
    
    // Separator
    lines.push('---');
    lines.push('');
    
    return lines.join('\n');
};

/**
 * Format entity metadata as Markdown footer section
 * This goes at the END of the transcript for machine readability
 */
export const formatEntityMetadataMarkdown = (metadata: TranscriptMetadata): string => {
    if (!metadata.entities) {
        return '';
    }
    
    const lines: string[] = [];
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Entity References');
    lines.push('');
    lines.push('<!-- Machine-readable entity metadata for indexing and querying -->');
    lines.push('');
    
    // People
    if (metadata.entities.people && metadata.entities.people.length > 0) {
        lines.push('### People');
        lines.push('');
        for (const person of metadata.entities.people) {
            lines.push(`- \`${person.id}\`: ${person.name}`);
        }
        lines.push('');
    }
    
    // Projects
    if (metadata.entities.projects && metadata.entities.projects.length > 0) {
        lines.push('### Projects');
        lines.push('');
        for (const project of metadata.entities.projects) {
            lines.push(`- \`${project.id}\`: ${project.name}`);
        }
        lines.push('');
    }
    
    // Terms
    if (metadata.entities.terms && metadata.entities.terms.length > 0) {
        lines.push('### Terms');
        lines.push('');
        for (const term of metadata.entities.terms) {
            lines.push(`- \`${term.id}\`: ${term.name}`);
        }
        lines.push('');
    }
    
    // Companies
    if (metadata.entities.companies && metadata.entities.companies.length > 0) {
        lines.push('### Companies');
        lines.push('');
        for (const company of metadata.entities.companies) {
            lines.push(`- \`${company.id}\`: ${company.name}`);
        }
        lines.push('');
    }
    
    return lines.join('\n');
};

/**
 * Parse entity metadata from a transcript
 * Reads the Entity References section if present
 */
export const parseEntityMetadata = (content: string): TranscriptMetadata['entities'] | undefined => {
    // Find the Entity References section
    // Look for "## Entity References" and capture everything after it until the next "##" header or end of content
    const headerIndex = content.indexOf('## Entity References');
    if (headerIndex === -1) {
        return undefined;
    }
    
    // Find the start of the content (after the header and any whitespace/newlines)
    let contentStart = headerIndex + '## Entity References'.length;
    // Skip whitespace and newlines
    while (contentStart < content.length && (content[contentStart] === '\n' || content[contentStart] === '\r' || content[contentStart] === ' ' || content[contentStart] === '\t')) {
        contentStart++;
    }
    
    // Find the end - look for next "##" at start of line or end of content
    const remainingContent = content.substring(contentStart);
    const nextHeaderMatch = remainingContent.match(/\n## /);
    const sectionContent = nextHeaderMatch 
        ? remainingContent.substring(0, nextHeaderMatch.index)
        : remainingContent;
    const entities: NonNullable<TranscriptMetadata['entities']> = {
        people: [],
        projects: [],
        terms: [],
        companies: [],
    };
    
    // Parse each entity type
    const parseEntities = (type: 'People' | 'Projects' | 'Terms' | 'Companies'): EntityReference[] => {
        // Map plural type names to singular entity types
        const typeMap: Record<string, 'person' | 'project' | 'term' | 'company'> = {
            'People': 'person',
            'Projects': 'project',
            'Terms': 'term',
            'Companies': 'company',
        };
        
        const entityType = typeMap[type];
        
        // Find the section for this type
        const sectionHeader = `### ${type}`;
        const sectionStart = sectionContent.indexOf(sectionHeader);
        if (sectionStart === -1) return [];
        
        // Find the end (next ### or end of content)
        // Skip past the header line (including newline)
        const headerEnd = sectionStart + sectionHeader.length;
        let sectionTextStart = headerEnd;
        // Skip whitespace and newlines after the header
        while (sectionTextStart < sectionContent.length && 
               (sectionContent[sectionTextStart] === '\n' || sectionContent[sectionTextStart] === '\r' || sectionContent[sectionTextStart] === ' ')) {
            sectionTextStart++;
        }
        
        const afterSection = sectionContent.substring(sectionTextStart);
        const nextSection = afterSection.search(/\n###/);
        const sectionText = nextSection === -1 ? afterSection : afterSection.substring(0, nextSection);
        
        // Extract items - match format: "- `id`: name"
        // Match bullet point with backticked ID and name
        const items: EntityReference[] = [];
        // Use multiline regex to match across lines, look for "- `id`: name" pattern
        const lines = sectionText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Match: "- `id`: name" or "- `id`:name" (with or without space after colon)
            const match = trimmed.match(/^- `([^`]+)`:\s*(.+)$/);
            if (match) {
                items.push({
                    id: match[1],
                    name: match[2].trim(),
                    type: entityType,
                });
            }
        }
        
        return items;
    };
    
    entities.people = parseEntities('People');
    entities.projects = parseEntities('Projects');
    entities.terms = parseEntities('Terms');
    entities.companies = parseEntities('Companies');
    
    // Only return if we found any entities
    const hasEntities = 
        entities.people.length > 0 ||
        entities.projects.length > 0 ||
        entities.terms.length > 0 ||
        entities.companies.length > 0;
    
    return hasEntities ? entities : undefined;
};

/**
 * Extract routing metadata from a RouteDecision
 */
export const createRoutingMetadata = (decision: Routing.RouteDecision): RoutingMetadata => {
    return {
        destination: decision.destination.path,
        confidence: decision.confidence,
        signals: decision.signals,
        reasoning: decision.reasoning,
    };
};

/**
 * Format duration in seconds to readable format (e.g., "2m 30s")
 */
export const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    
    if (minutes === 0) {
        return `${secs}s`;
    }
    
    if (secs === 0) {
        return `${minutes}m`;
    }
    
    return `${minutes}m ${secs}s`;
};

/**
 * Format time as HH:MM AM/PM
 */
export const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
};

/**
 * Extract topic from routing signals
 */
export const extractTopicFromSignals = (signals: Routing.ClassificationSignal[]): string | undefined => {
    const topicSignal = signals.find(s => s.type === 'topic' || s.type === 'context_type');
    return topicSignal?.value;
};

/**
 * Extract all tags from routing signals
 * Tags are deduplicated to avoid duplicates from multiple signal sources
 */
export const extractTagsFromSignals = (signals: Routing.ClassificationSignal[]): string[] => {
    const tags = signals
        .filter(s => s.type !== 'context_type')  // Skip generic context type
        .map(s => s.value)
        .filter((v): v is string => typeof v === 'string');
    
    // Deduplicate tags using Set
    return Array.from(new Set(tags));
};

// ============================================================================
// Lifecycle Utilities
// ============================================================================

/**
 * Valid transcript statuses for validation
 */
export const VALID_STATUSES: TranscriptStatus[] = [
    'initial', 'enhanced', 'reviewed', 'in_progress', 'closed', 'archived'
];

/**
 * Check if a string is a valid TranscriptStatus
 */
export const isValidStatus = (status: string): status is TranscriptStatus => {
    return VALID_STATUSES.includes(status as TranscriptStatus);
};

/**
 * Generate a unique task ID
 */
export const generateTaskId = (): string => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `task-${timestamp}-${random}`;
};

/**
 * Create a new task
 */
export const createTask = (description: string): Task => {
    return {
        id: generateTaskId(),
        description,
        status: 'open',
        created: new Date().toISOString(),
    };
};

/**
 * Update transcript status and record the transition in history
 * Returns unchanged metadata if status is the same (no duplicate history)
 */
export const updateStatus = (
    metadata: TranscriptMetadata,
    newStatus: TranscriptStatus
): TranscriptMetadata => {
    const oldStatus = metadata.status;
    
    // Don't add duplicate history if status unchanged
    if (oldStatus === newStatus) {
        return metadata;
    }
    
    const transition: StatusTransition = {
        from: oldStatus || 'reviewed',
        to: newStatus,
        at: new Date().toISOString(),
    };
    
    return {
        ...metadata,
        status: newStatus,
        history: [...(metadata.history || []), transition],
    };
};

/**
 * Apply default lifecycle fields to metadata
 * Used during lazy migration of old-format transcripts
 */
export const applyLifecycleDefaults = (metadata: TranscriptMetadata): TranscriptMetadata => {
    return {
        ...metadata,
        status: metadata.status ?? 'reviewed',
        history: metadata.history ?? [],
        tasks: metadata.tasks ?? [],
    };
};

/**
 * Complete a task by ID
 */
export const completeTask = (metadata: TranscriptMetadata, taskId: string): TranscriptMetadata => {
    const tasks = metadata.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
        throw new Error(`Task not found: ${taskId}`);
    }
    
    const now = new Date().toISOString();
    const updatedTasks = [...tasks];
    updatedTasks[taskIndex] = {
        ...updatedTasks[taskIndex],
        status: 'done',
        changed: now,
        completed: now,
    };
    
    return {
        ...metadata,
        tasks: updatedTasks,
    };
};

/**
 * Delete a task by ID
 */
export const deleteTask = (metadata: TranscriptMetadata, taskId: string): TranscriptMetadata => {
    const tasks = metadata.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
        throw new Error(`Task not found: ${taskId}`);
    }
    
    return {
        ...metadata,
        tasks: tasks.filter(t => t.id !== taskId),
    };
};

/**
 * Add a task to metadata
 */
export const addTask = (metadata: TranscriptMetadata, description: string): { metadata: TranscriptMetadata; task: Task } => {
    const task = createTask(description);
    
    return {
        metadata: {
            ...metadata,
            tasks: [...(metadata.tasks || []), task],
        },
        task,
    };
};


