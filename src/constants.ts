import os from 'node:os';
import { FilenameOption } from '@utilarium/dreadcabinet';
import { FilesystemStructure } from '@utilarium/dreadcabinet';

export const VERSION = '__VERSION__ (__GIT_BRANCH__/__GIT_COMMIT__ __GIT_TAGS__ __GIT_COMMIT_DATE__) __SYSTEM_INFO__';
export const PROGRAM_NAME = 'protokoll';
export const DEFAULT_CHARACTER_ENCODING = 'utf-8';
export const DEFAULT_BINARY_TO_TEXT_ENCODING = 'base64';
export const DEFAULT_DIFF = true;
export const DEFAULT_LOG = false;
export const DEFAULT_TIMEZONE = 'Etc/UTC';
export const DATE_FORMAT_MONTH_DAY = 'M-D';
export const DATE_FORMAT_YEAR = 'YYYY';
export const DATE_FORMAT_YEAR_MONTH = 'YYYY-M';
export const DATE_FORMAT_YEAR_MONTH_DAY = 'YYYY-M-D';
export const DATE_FORMAT_YEAR_MONTH_DAY_SLASH = 'YYYY/M/D';
export const DATE_FORMAT_YEAR_MONTH_DAY_HOURS_MINUTES = 'YYYY-M-D-HHmm';
export const DATE_FORMAT_YEAR_MONTH_DAY_HOURS_MINUTES_SECONDS = 'YYYY-M-D-HHmmss';
export const DATE_FORMAT_YEAR_MONTH_DAY_HOURS_MINUTES_SECONDS_MILLISECONDS = 'YYYY-M-D-HHmmss.SSS';
export const DATE_FORMAT_MONTH = 'M';
export const DATE_FORMAT_DAY = 'D';
export const DATE_FORMAT_HOURS = 'HHmm';
export const DATE_FORMAT_MINUTES = 'mm';
export const DATE_FORMAT_SECONDS = 'ss';
export const DATE_FORMAT_MILLISECONDS = 'SSS';
export const DEFAULT_VERBOSE = false;
export const DEFAULT_DRY_RUN = false;
export const DEFAULT_DEBUG = false;
export const DEFAULT_CONTENT_TYPES = ['diff'];
export const DEFAULT_RECURSIVE = false;
export const DEFAULT_INPUT_DIRECTORY = './';
export const DEFAULT_OUTPUT_DIRECTORY = './';

export const DEFAULT_AUDIO_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'qta'];

export const ALLOWED_CONTENT_TYPES = ['log', 'diff'];
export const ALLOWED_AUDIO_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'qta'];

export const DEFAULT_OUTPUT_STRUCTURE = 'month' as FilesystemStructure;
export const DEFAULT_OUTPUT_FILENAME_OPTIONS = ['date', 'time', 'subject'] as FilenameOption[];

export const ALLOWED_OUTPUT_STRUCTURES = ['none', 'year', 'month', 'day'] as FilesystemStructure[];
export const ALLOWED_OUTPUT_FILENAME_OPTIONS = ['date', 'time', 'subject'] as FilenameOption[];

export const DEFAULT_CONFIG_DIR = `./.${PROGRAM_NAME}`;
export const DEFAULT_PROCESSED_DIR = './processed';

// Context System Constants
export const DEFAULT_CONTEXT_DIR_NAME = '.protokoll';
export const DEFAULT_CONTEXT_NAMESPACE = 'redaksjon';
export const DEFAULT_CONTEXT_CONFIG_FILE_NAME = 'config.yaml';
export const DEFAULT_MAX_DISCOVERY_LEVELS = 10;

export const CONTEXT_SUBDIRECTORIES = {
    people: 'people',
    projects: 'projects',
    companies: 'companies',
    terms: 'terms',
} as const;

export const DEFAULT_PERSONAS_DIR = `/personas`;

export const DEFAULT_PERSONA_TRANSCRIBER_FILE = `${DEFAULT_PERSONAS_DIR}/transcriber.md`;

export const DEFAULT_INSTRUCTIONS_DIR = `/instructions`;

export const DEFAULT_INSTRUCTIONS_TRANSCRIBE_FILE = `${DEFAULT_INSTRUCTIONS_DIR}/transcribe.md`;

// Note: We no longer maintain a static allowlist of models
// This allows for dynamic model discovery and future model additions
// Users can specify any model supported by their OpenAI API

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
export const DEFAULT_MODEL = 'gpt-5.2';
export const DEFAULT_REASONING_LEVEL = 'medium';

// Smart Assistance Constants
export const DEFAULT_PHONETIC_MODEL = 'gpt-5-nano';
export const DEFAULT_ANALYSIS_MODEL = 'gpt-5-mini';
export const DEFAULT_SMART_ASSISTANCE = true;

// Project-specific smart assistance
export const DEFAULT_SOUNDS_LIKE_ON_ADD = true;      // Generate phonetic variants
export const DEFAULT_TRIGGER_PHRASES_ON_ADD = true;  // Generate content-matching phrases
export const DEFAULT_PROMPT_FOR_SOURCE = true;

// Term-specific smart assistance
export const DEFAULT_TERMS_ENABLED = true;
export const DEFAULT_TERM_SOUNDS_LIKE_ON_ADD = true;
export const DEFAULT_TERM_DESCRIPTION_ON_ADD = true;
export const DEFAULT_TERM_TOPICS_ON_ADD = true;
export const DEFAULT_TERM_PROJECT_SUGGESTIONS = true;

// Content limits
export const MAX_CONTENT_LENGTH = 15000;  // Max characters to send to LLM
export const MAX_TERM_CONTEXT_LENGTH = 10000;  // Max characters for term context
export const ASSIST_TIMEOUT_MS = 30000;   // 30 second timeout for LLM calls
export const TERM_ASSIST_TIMEOUT_MS = 20000;   // 20 second timeout for term LLM calls

export const DEFAULT_OVERRIDES = false;
export const DEFAULT_MAX_AUDIO_SIZE = 26214400; // 25MB in bytes
export const DEFAULT_TEMP_DIRECTORY = os.tmpdir(); // Use OS default temp directory
export const DEFAULT_INTERACTIVE = true;  // Interactive prompts enabled by default
export const DEFAULT_SELF_REFLECTION = true;
export const DEFAULT_SILENT = false; // Sound notifications enabled by default

// Output Management Constants
export const DEFAULT_INTERMEDIATE_DIRECTORY = './output/protokoll';
export const DEFAULT_KEEP_INTERMEDIATES = true;
export const OUTPUT_FILE_TYPES = [
    'transcript',
    'context',
    'request',
    'response',
    'reflection',
    'session',
] as const;

// Define Protokoll-specific defaults
export const PROTOKOLL_DEFAULTS = {
    dryRun: DEFAULT_DRY_RUN,
    verbose: DEFAULT_VERBOSE,
    debug: DEFAULT_DEBUG,
    diff: DEFAULT_DIFF,
    log: DEFAULT_LOG,
    transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
    model: DEFAULT_MODEL,
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    contentTypes: DEFAULT_CONTENT_TYPES,
    overrides: DEFAULT_OVERRIDES,
    maxAudioSize: DEFAULT_MAX_AUDIO_SIZE,
    tempDirectory: DEFAULT_TEMP_DIRECTORY || os.tmpdir(),
    configDirectory: DEFAULT_CONFIG_DIR,
    interactive: DEFAULT_INTERACTIVE,
    selfReflection: DEFAULT_SELF_REFLECTION,
    silent: DEFAULT_SILENT,
};
