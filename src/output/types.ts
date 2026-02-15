/**
 * Output Management Types
 *
 * Types for managing intermediate and final output files.
 */

export interface OutputConfig {
    intermediateDir: string;      // Default: ./output/protokoll
    keepIntermediates: boolean;   // Default: true in debug mode
    timestampFormat: string;      // Default: YYMMDD-HHmm
}

export interface IntermediateFiles {
    transcript: string;           // Raw Whisper output (in intermediateDir, for debugging)
    context: string;              // Context snapshot
    request: string;              // LLM request
    response: string;             // LLM response
    reflection?: string;          // Self-reflection report
    session?: string;             // Interactive session log
}

/**
 * Raw transcript metadata stored alongside the transcript
 */
export interface RawTranscriptData {
    text: string;                 // The raw Whisper output text
    model: string;                // Model used for transcription (e.g., whisper-1)
    duration: number;             // Time taken for transcription in ms
    audioFile: string;            // Original audio file path
    audioHash: string;            // Hash of the audio file for identification
    transcribedAt: string;        // ISO timestamp of when transcription occurred
}

export interface OutputPaths {
    final: string;                // Routed destination (e.g., /notes/2026/1/14-meeting.pkl)
    rawTranscript: string;        // Raw transcript in .transcript/ alongside final
    intermediate: IntermediateFiles;
}
