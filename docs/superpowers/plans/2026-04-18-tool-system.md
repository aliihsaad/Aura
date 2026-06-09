# Phase 7: Hybrid Tool System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-facing tools (`recall_memory`, `save_memory`) so the assistant can explicitly recall context and save information during answer generation.

**Architecture:** Tool definitions in OpenRouter function-calling format. A `ToolExecutorFn` closure captures service dependencies. `LLMService.generateAnswer` handles tool_calls in the stream, executes them, feeds results back, then streams the final answer. Max 1 tool round per answer.

**Tech Stack:** OpenRouter function calling API, existing `RecallService` and `MemoryStore`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/main/services/agent/tool-definitions.ts` | Tool schemas + executor factory |
| Modify | `src/main/services/llm-service.ts` | Accept tools, handle tool_calls in stream, multi-turn |
| Modify | `src/shared/types.ts` | Add `ToolCallRequest` type, extend `LLMRequest` |
| Modify | `src/main/ipc-handlers.ts` | Create tool executor, pass to LLM calls |

---

### Task 1: Add tool-related types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add types after EmbeddingRecord**

Add after the `EmbeddingRecord` interface:

```ts
// ── Tool System ──────────────────────────────────────────

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

export interface ToolCallRequest {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export type ToolExecutorFn = (name: string, args: Record<string, any>) => Promise<string>
```

- [ ] **Step 2: Extend LLMRequest**

Add two optional fields to the existing `LLMRequest` interface:

```ts
  tools?: ToolDefinition[]
  executeToolCall?: ToolExecutorFn
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add tool system types"
```

---

### Task 2: Create tool-definitions.ts

**Files:**
- Create: `src/main/services/agent/tool-definitions.ts`

- [ ] **Step 1: Create the file**

```ts
import { ToolDefinition, ToolExecutorFn, WhisphryMemoryType } from '@shared/types'
import { RecallService } from '../memory/recall-service'
import { MemoryStore } from '../memory/memory-store'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description:
        'Search past memories for relevant context. Use when the conversation references past events, people, or topics that might have been discussed before.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for in past memories',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Save a piece of information for future reference. Use only when the user explicitly asks to remember something specific.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Brief title for the memory (under 80 chars)',
          },
          summary: {
            type: 'string',
            description: 'What to remember — be specific and self-contained',
          },
          type: {
            type: 'string',
            enum: ['note', 'fact', 'task', 'insight'],
            description: 'Category of memory',
          },
        },
        required: ['title', 'summary', 'type'],
      },
    },
  },
]

interface ToolExecutorDeps {
  recallService: RecallService
  memoryStore: MemoryStore
  sessionFolderName?: string
}

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutorFn {
  return async (name: string, args: Record<string, any>): Promise<string> => {
    try {
      switch (name) {
        case 'recall_memory':
          return await executeRecallMemory(deps, args)
        case 'save_memory':
          return await executeSaveMemory(deps, args)
        default:
          return `Unknown tool: ${name}`
      }
    } catch (error) {
      console.error(`[ToolExecutor] Error executing ${name}:`, error)
      return `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

async function executeRecallMemory(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const query = String(args.query || '').trim()
  if (!query) return 'No query provided.'

  const results = await deps.recallService.search({
    query,
    limit: 5,
    sessionFolderName: deps.sessionFolderName,
  })

  if (results.length === 0) return 'No relevant memories found.'

  const lines = results.map((result, index) => {
    const parts = [`${index + 1}. [${result.kind}] ${result.title}`]
    if (result.summary) parts.push(`   ${result.summary}`)
    parts.push(`   Score: ${result.score}, Matched: ${result.matchedTerms.join(', ')}`)
    return parts.join('\n')
  })

  return lines.join('\n\n')
}

async function executeSaveMemory(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const title = String(args.title || '').trim()
  const summary = String(args.summary || '').trim()
  const type = String(args.type || 'note').trim() as WhisphryMemoryType

  if (!title || !summary) return 'Title and summary are required.'

  const validTypes: WhisphryMemoryType[] = ['note', 'fact', 'task', 'insight']
  const memoryType = validTypes.includes(type) ? type : 'note'

  const memory = deps.memoryStore.createMemory({
    type: memoryType,
    title,
    summary,
    status: 'active',
    confidence: 0.9,
    tags: ['user-requested'],
  })

  deps.memoryStore.append(memory)

  return `Memory saved: "${title}" (${memoryType}, id: ${memory.id})`
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/tool-definitions.ts
git commit -m "feat: add tool definitions and executor for recall_memory and save_memory"
```

---

### Task 3: Add tool_calls handling to LLMService

**Files:**
- Modify: `src/main/services/llm-service.ts`

This is the critical change. The streaming `callOpenRouter` method needs to detect tool_calls, execute them, and make a follow-up call.

- [ ] **Step 1: Import tool types**

Add to imports at top of file:

```ts
import { ToolCallRequest, ToolDefinition, ToolExecutorFn } from '@shared/types'
```

- [ ] **Step 2: Update generateAnswer to pass tools through**

In the `generateAnswer` method, change the final `callOpenRouter` call from:

```ts
await this.callOpenRouter(messages, 0.7, 1024)
```

to:

```ts
await this.callOpenRouter(messages, 0.7, 1024, request.tools, request.executeToolCall)
```

- [ ] **Step 3: Update callOpenRouter signature and body**

Change the `callOpenRouter` method signature to accept optional tools and executor:

```ts
private async callOpenRouter(
  messages: Array<{ role: string; content: any; tool_calls?: any[] }>,
  temperature: number,
  maxTokens: number,
  tools?: ToolDefinition[],
  executeToolCall?: ToolExecutorFn
): Promise<void> {
```

In the request body, conditionally include tools:

```ts
body: JSON.stringify({
  model: this.model,
  messages,
  stream: true,
  temperature,
  max_tokens: maxTokens,
  ...(tools && tools.length > 0 ? { tools } : {}),
}),
```

- [ ] **Step 4: Add tool_calls accumulation to the stream parser**

Inside the `callOpenRouter` method, add a `toolCalls` accumulator before the while loop:

```ts
const toolCalls: ToolCallRequest[] = []
```

In the stream parsing loop, after the existing `delta.content` check, add tool_calls detection:

```ts
try {
  const parsed = JSON.parse(data)
  const delta = parsed.choices?.[0]?.delta
  const content = delta?.content
  if (content) {
    fullAnswer += content
    this.emit('chunk', content, fullAnswer)
  }
  // Accumulate tool calls from stream
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.index !== undefined) {
        if (!toolCalls[tc.index]) {
          toolCalls[tc.index] = {
            id: tc.id || '',
            function: { name: '', arguments: '' },
          }
        }
        if (tc.id) toolCalls[tc.index].id = tc.id
        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments
      }
    }
  }
} catch {
  // Skip malformed JSON chunks
}
```

- [ ] **Step 5: Add tool execution after stream ends**

After the while loop and before the final `this.emitFinalAnswer(fullAnswer)`, add the tool execution block:

```ts
// Handle tool calls if present
const validToolCalls = toolCalls.filter((tc) => tc && tc.id && tc.function.name)
if (validToolCalls.length > 0 && executeToolCall) {
  // Add assistant message with tool_calls
  messages.push({
    role: 'assistant',
    content: fullAnswer || null,
    tool_calls: validToolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  })

  // Execute each tool and add result messages
  for (const tc of validToolCalls) {
    let args: Record<string, any> = {}
    try {
      args = JSON.parse(tc.function.arguments)
    } catch {
      args = {}
    }
    const result = await executeToolCall(tc.function.name, args)
    messages.push({
      role: 'tool' as any,
      content: result,
      tool_call_id: tc.id,
    } as any)
  }

  // Make follow-up call WITHOUT tools to get the final answer
  fullAnswer = ''
  await this.callOpenRouter(messages, temperature, maxTokens)
  return
}

this.emitFinalAnswer(fullAnswer)
```

Note: the follow-up call passes NO tools (preventing infinite loops). The recursive call will stream the final answer normally.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/main/services/llm-service.ts
git commit -m "feat: add tool_calls handling to LLM streaming"
```

---

### Task 4: Wire tool executor into ipc-handlers.ts

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Import tool definitions**

Add import:

```ts
import { TOOL_DEFINITIONS, createToolExecutor } from './services/agent/tool-definitions'
```

- [ ] **Step 2: Pass tools to LLM answer generation**

Find all places where `generateAnswer` is called and add tools + executor. There will be calls in the answer generation flow. For each `generateAnswer` call that should have tools, add to the request object:

```ts
tools: TOOL_DEFINITIONS,
executeToolCall: createToolExecutor({
  recallService,
  memoryStore,
  sessionFolderName: /* current session folder if available */,
}),
```

Search for all `llmService.generateAnswer(` calls and update them. The `request` object passed to `generateAnswer` should include the `tools` and `executeToolCall` fields.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: wire tool executor into answer generation"
```

---

### Task 5: Full build verification

- [ ] **Step 1: Clean build**

```bash
rm -rf out && npm run build
```

- [ ] **Step 2: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: Phase 7 — hybrid tool system (complete)"
```
