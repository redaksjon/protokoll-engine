# @redaksjon/protokoll-engine

Processing engine for Protokoll - transcription pipeline, agentic execution, routing, and LLM integration.

## Overview

This package contains the core processing logic extracted from the monolithic `@redaksjon/protokoll` package. It includes:

- **Pipeline**: Orchestration of transcription phases
- **Phases**: Transcribe, simple-replace, locate, complete
- **Agentic**: Tool-based execution with context awareness
- **Reasoning**: LLM client wrapper (OpenAI, Anthropic, Gemini)
- **Routing**: Multi-signal classification and confidence scoring
- **Transcription**: OpenAI Whisper integration with audio preprocessing
- **Prompt**: Prompt construction using RiotPrompt
- **Feedback**: Natural language feedback processing
- **Reflection**: Self-reflection and reporting
- **Transcript Operations**: Edit, combine, change-date operations

## Installation

```bash
npm install @redaksjon/protokoll-engine
```

## Dependencies

- `@redaksjon/context` - Entity management and context system
- `@redaksjon/protokoll-format` - Transcript storage format
- `@anthropic-ai/sdk`, `openai`, `@google/generative-ai` - LLM providers
- `@kjerneverk/riotprompt` - Prompt construction
- `fluent-ffmpeg` - Audio processing

## Usage

This package is primarily used by `@redaksjon/protokoll` (the MCP server). It can also be used programmatically:

```typescript
import { Pipeline, Reasoning, Routing } from '@redaksjon/protokoll-engine';

// Use the processing pipeline
// (API examples will be added as modules are extracted)
```

## License

Apache-2.0
TEST
