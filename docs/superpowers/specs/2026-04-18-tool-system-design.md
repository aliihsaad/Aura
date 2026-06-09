# Phase 7: Hybrid Tool System — Design Spec

## Goal

Add an LLM-facing tool layer so the assistant can explicitly recall memories and save information on command, while the existing automatic pipeline continues to handle the common case.

## Scope

Two tools for v1:

1. **`recall_memory`** — LLM searches past memories when it decides extra context would help. Returns ranked results.
2. **`save_memory`** — LLM saves a specific piece of information when the user asks ("remember that..."). Creates a memory record.

## What stays the same

- Automatic memory extraction pipeline (transcript events → extraction → memories)
- Automatic recall injection into system prompts (session/answer/screenshot recall context)
- Streaming answer generation flow (default path, most answers)

## Architecture

### New files

- `src/main/services/agent/tool-definitions.ts` — OpenRouter-compatible tool schemas
- `src/main/services/agent/tool-executor.ts` — executes tool calls, returns results

### Modified files

- `src/main/services/llm-service.ts` — accept optional tools + executor, handle tool_calls in stream, multi-turn loop
- `src/main/ipc-handlers.ts` — create tool executor with service dependencies, pass to LLM calls
- `src/shared/types.ts` — add tool-related types to LLMRequest

## Tool Definitions (OpenRouter format)

```json
[
  {
    "type": "function",
    "function": {
      "name": "recall_memory",
      "description": "Search past memories for relevant context. Use when the conversation references past events, people, or topics.",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "What to search for" }
        },
        "required": ["query"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "save_memory",
      "description": "Save information for future reference. Use when the user explicitly asks to remember something.",
      "parameters": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "Brief title" },
          "summary": { "type": "string", "description": "What to remember" },
          "type": { "type": "string", "enum": ["note", "fact", "task", "insight"] }
        },
        "required": ["title", "summary", "type"]
      }
    }
  }
]
```

## Response Flow

```
generateAnswer called with tools + executor
  → API call (streaming, tools included)
  → stream chunks
    → if delta.content: emit 'chunk' as before
    → if delta.tool_calls: accumulate tool call data
  → stream ends
    → if tool_calls present:
        1. execute each tool via executor
        2. append assistant message (with tool_calls) + tool result messages
        3. make another streaming API call (no tools this round to prevent loops)
        4. stream final answer normally
    → if no tool_calls:
        emit 'done' as before
```

Max 1 tool round per answer to prevent runaway loops.

## Tool Executor Interface

```ts
type ToolExecutorFn = (name: string, args: Record<string, any>) => Promise<string>
```

The executor is a closure created in `ipc-handlers.ts` that captures the memory services. `LLMService` stays decoupled — it just calls the function.

## Error Handling

- Tool execution errors are caught and returned as error text to the LLM (it can explain the failure)
- If tool round fails entirely, fall back to answering without tool results
- Tool executor never throws — always returns a string (success message or error description)

## Not included

- `search_artifacts`, `open_artifact`, `show_bubble`, `speak_text` — future phases
- Replacing the automatic pipeline
- Complex tool registry patterns
- Tool call UI indicators (could add later)
