import { RecallResult, ToolDefinition, ToolExecutorFn, WhisphryMemoryType, ArtifactListFilters } from '@shared/types'
import { MemoryStore } from '../memory/memory-store'
import { RecallService } from '../memory/recall-service'
import { ArtifactStore } from '../memory/artifact-store'
import { WidgetManager } from '../canvas/widget-manager'
import { checkInterruptionPolicy, resolveAutoPolicy } from './interruption-policy'
import type { InterruptionPolicy } from '@shared/types'

// ── Tool schemas (OpenRouter function-calling format) ─────────────────────────

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
            description: 'The search query to look up in past memories.',
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
        'Save a piece of information for future reference. ONLY CALL when the user EXPLICITLY commands a save with a clear verb: "save this", "save that", "save as a note", "remember this", "note that", "log this", "write this down", or a direct paraphrase. DO NOT call this just because the topic feels memorable, useful, or important — that judgement is the user\'s, not yours. DO NOT call it on every question that touches a "fact". A hard 60-second cooldown is enforced server-side: a second call within 60s of the last save will be refused and you will be told the user feels spammed. Default type="note"; use "task" only for TODOs, "insight" only for realizations the user states aloud, "fact" only for durable user-asserted facts.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'A short, descriptive title for the memory.',
          },
          summary: {
            type: 'string',
            description: 'A concise summary of the information to remember.',
          },
          type: {
            type: 'string',
            enum: ['note', 'fact', 'task', 'insight'],
            description: 'The category of memory being saved.',
          },
        },
        required: ['title', 'summary', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_session_context',
      description:
        'Return the app-managed session context summary, including recent conversation, recalled memory, and the latest tracked screen summary. Use this when you need continuity about what has happened in the current session.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'Search the public web for current information and source links. Use this when the user asks for recent facts, web references, or information that may not be in the workspace or memory.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The web search query.',
          },
          limit: {
            type: 'number',
            description: 'Optional number of results to return. Defaults to 5.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image from a text prompt and save it as an artifact. Use this only when the user explicitly asks for an image, concept visualization, illustration, or mock asset.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The image generation prompt.',
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
            description: 'Optional image size. Defaults to 1024x1024.',
          },
          quality: {
            type: 'string',
            enum: ['auto', 'low', 'medium', 'high'],
            description: 'Optional image quality. Defaults to auto.',
          },
          background: {
            type: 'string',
            enum: ['auto', 'transparent', 'opaque'],
            description: 'Optional background handling. Defaults to auto.',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_current_screen',
      description:
        'Capture and inspect the user\'s current screen. Use when the user explicitly asks what is visible, asks you to look at the screen, or asks about current on-screen content. Never guess about screen contents without using this tool first.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Optional user question to answer using the current screen, e.g. "What do you see?" or "What error is shown here?"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_bubble',
      description:
        'Display a small proactive message to the user. Use when you notice something relevant worth mentioning, like a connection to past context or a reminder. Keep messages short (1-2 sentences).',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to show in the bubble.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'How important this message is. Use high sparingly.',
          },
          expandable: {
            type: 'boolean',
            description: 'Whether the user can click to expand this into a full panel.',
          },
        },
        required: ['message', 'urgency'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_panel',
      description:
        'Open a content panel with detailed information. Use for substantial content like recalled context, analysis, or multi-paragraph responses.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Panel title displayed in the header.',
          },
          content: {
            type: 'string',
            description: 'The content to display. Supports markdown.',
          },
          panel_type: {
            type: 'string',
            enum: ['answer', 'preview', 'context'],
            description: 'The type of panel to display.',
          },
        },
        required: ['title', 'content', 'panel_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_toast',
      description:
        'Flash a brief status notification. Auto-dismisses after a few seconds. Use for confirmations and status updates.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Short notification message.',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_widget',
      description: 'Close a specific widget by its ID.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: {
            type: 'string',
            description: 'The ID of the widget to close.',
          },
        },
        required: ['widget_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_artifacts',
      description:
        'Search saved artifacts like screenshots, transcripts, and files. Use when the user asks about past captures or files.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against artifact paths, types, and metadata.',
          },
          type: {
            type: 'string',
            description: 'Optional artifact type filter (e.g. "screenshot.image", "session.transcript").',
          },
          session: {
            type: 'string',
            description: 'Optional session folder name to scope the search.',
          },
        },
        required: ['query'],
      },
    },
  },
]

export const LIVE_AGENT_EXTRA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'insert_solution_into_editor',
      description:
        'Prepare code or text for insertion into the user\'s editor. Use only when the user explicitly wants you to apply, paste, or insert a solution. This tool safely copies the content to the clipboard for the user to paste.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The exact code or text to copy for insertion.',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code_analysis_on_screen',
      description:
        'Analyze code, errors, stack traces, or editor content visible on the current screen. Use when the screen shows code or a technical error and you need a grounded read of what is visible before responding.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Optional specific coding question about what is visible on screen.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_current_task',
      description:
        'Return a short grounded summary of what the user appears to be working on right now based on session context, recent conversation, and latest screen tracking.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_recent_artifact',
      description:
        'Preview the most relevant recent artifact inside the app preview window. Use when the user wants to see a saved screenshot, document, transcript, or image without leaving the app.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query used to select the most relevant artifact to preview.',
          },
          type: {
            type: 'string',
            description: 'Optional artifact type filter, e.g. "screenshot.image" or "session.transcript".',
          },
          session: {
            type: 'string',
            description: 'Optional session folder name to scope the search.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_answer_window',
      description:
        'Open the main detail window with a substantial response. Use for long, structured, or tool-heavy results that do not fit a short bubble.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short title or question shown in the answer window header.',
          },
          content: {
            type: 'string',
            description: 'Detailed content to display in the answer window.',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'solve_with_openrouter',
      description:
        'Hand a complex request to the OpenRouter answer pipeline and stream the result into the answer window. Use for hard coding, debugging, multi-step reasoning, deep analysis, web search, image generation, or any task too large or too tool-heavy for a short companion bubble.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The full task or question to solve using OpenRouter.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_recent_artifact',
      description:
        'Open the most relevant recent artifact, such as a screenshot, transcript, or saved answer file. Use when the user asks to open a past capture or session artifact.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query used to select the most relevant artifact to open.',
          },
          type: {
            type: 'string',
            description: 'Optional artifact type filter, e.g. "screenshot.image" or "session.transcript".',
          },
          session: {
            type: 'string',
            description: 'Optional session folder name to scope the search.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_answer_as_memory',
      description:
        'Save the latest answer-window output as a memory when the result is worth keeping for later. Use after producing a strong answer or solved result the user is likely to need again.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Optional custom title for the saved memory.',
          },
          type: {
            type: 'string',
            enum: ['note', 'fact', 'task', 'insight'],
            description: 'Optional memory type. Defaults to insight.',
          },
        },
      },
    },
  },
]

// ── Executor deps ─────────────────────────────────────────────────────────────

interface ToolExecutorDeps {
  recallService: RecallService
  memoryStore: MemoryStore
  artifactStore?: ArtifactStore
  widgetManager?: WidgetManager
  getSessionContextSummary?: () => string
  analyzeCurrentScreen?: (question?: string) => Promise<string>
  copyToClipboard?: (text: string) => void
  openArtifactById?: (artifactId: string) => Promise<unknown> | unknown
  previewArtifactById?: (artifactId: string) => Promise<unknown> | unknown
  getCurrentTaskSummary?: () => string
  getLatestAnswerSnapshot?: () => { question: string; answer: string } | null
  openAnswerWindow?: (title: string, content: string) => void
  solveWithOpenRouter?: (question: string) => Promise<string> | string
  searchWeb?: (query: string, limit?: number) => Promise<{
    query: string
    provider: string
    results: Array<{ title: string; url: string; snippet?: string }>
  }>
  generateImage?: (params: {
    prompt: string
    size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
    quality?: 'auto' | 'low' | 'medium' | 'high'
    background?: 'auto' | 'transparent' | 'opaque'
  }) => Promise<{
    artifactId: string
    relativePath: string
    revisedPrompt?: string
  }>
  requestApproval?: (input: {
    toolName: string
    summary: string
    payload: Record<string, any>
    preview?: string
    bytes?: number
  }) => Promise<'approve' | 'decline' | 'always-allow-session'>
  sessionFolderName?: string
  getInterruptionPolicy?: () => InterruptionPolicy
  getLastEventTimestamp?: () => number
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutorFn {
  return async (
    name: string,
    args: Record<string, any>,
    signal?: AbortSignal
  ): Promise<string> => {
    try {
      switch (name) {
        case 'recall_memory':
          return await executeRecallMemory(deps, args)
        case 'save_memory':
          return await executeSaveMemory(deps, args)
        case 'get_session_context':
          return executeGetSessionContext(deps)
        case 'search_web':
          return await executeSearchWeb(deps, args)
        case 'generate_image':
          return await executeGenerateImage(deps, args)
        case 'analyze_current_screen':
          return await executeAnalyzeCurrentScreen(deps, args)
        case 'insert_solution_into_editor':
          return executeInsertSolutionIntoEditor(deps, args)
        case 'run_code_analysis_on_screen':
          return await executeRunCodeAnalysisOnScreen(deps, args)
        case 'summarize_current_task':
          return executeSummarizeCurrentTask(deps)
        case 'preview_recent_artifact':
          return await executePreviewRecentArtifact(deps, args)
        case 'open_answer_window':
          return executeOpenAnswerWindow(deps, args)
        case 'solve_with_openrouter':
          return await executeSolveWithOpenRouter(deps, args)
        case 'open_recent_artifact':
          return await executeOpenRecentArtifact(deps, args)
        case 'save_answer_as_memory':
          return executeSaveAnswerAsMemory(deps, args)
        case 'show_bubble':
          return executeShowBubble(deps, args)
        case 'show_panel':
          return executeShowPanel(deps, args)
        case 'show_toast':
          return executeShowToast(deps, args)
        case 'dismiss_widget':
          return executeDismissWidget(deps, args)
        case 'search_artifacts':
          return await executeSearchArtifacts(deps, args)
        default:
          return `Unknown tool: "${name}". No action was taken.`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Tool "${name}" failed: ${message}`
    }
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

// Some OpenRouter-routed models (notably Claude family) sometimes pass file
// paths under aliases like `file_path` or `filename`. Accept a small set of
// common synonyms so a slightly-malformed tool call still works.
function pickPathArg(args: Record<string, any>): string {
  const candidates = [args.path, args.file_path, args.filepath, args.filename, args.file, args.target_path, args.target]
  for (const c of candidates) {
    const v = String(c ?? '').trim()
    if (v) return v
  }
  return ''
}

function pickContentArg(args: Record<string, any>): string {
  const candidates = [args.content, args.text, args.body, args.file_content, args.contents, args.data]
  for (const c of candidates) {
    if (c !== undefined && c !== null) return String(c)
  }
  return ''
}

async function executeRecallMemory(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) {
    return 'No query provided. Please supply a search query.'
  }

  const results: RecallResult[] = await deps.recallService.search({
    query,
    limit: 5,
    sessionFolderName: deps.sessionFolderName,
  })

  if (results.length === 0) {
    return `No memories found for query: "${query}".`
  }

  const lines = results.map((result, index) => {
    const matched =
      result.matchedTerms.length > 0 ? result.matchedTerms.join(', ') : 'none'
    return (
      `${index + 1}. [${result.kind}] ${result.title}\n` +
      `   Summary: ${result.summary}\n` +
      `   Score: ${result.score} | Matched: ${matched}`
    )
  })

  return `Found ${results.length} result(s) for "${query}":\n\n${lines.join('\n\n')}`
}

// User feedback 2026-05-11_004349 session: agent over-saved — said
// "Save that" once, agent saved on every subsequent question. Quote:
// "stop this saving your fuck. No I asked you to save once." So we
// enforce a hard cooldown at the executor level. The agent can call
// save_memory all it wants; only the first call inside a 60s window
// actually persists. Re-saves return a rejection string that the model
// reads as a tool result — "you just saved 12s ago, don't save again
// unless the user explicitly asks for a new save."
const SAVE_MEMORY_COOLDOWN_MS = 60_000
let lastSaveMemoryAt = 0
let lastSaveMemoryTitle = ''

async function executeSaveMemory(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const title = String(args.title ?? '').trim()
  const summary = String(args.summary ?? '').trim()
  const type = String(args.type ?? '') as WhisphryMemoryType

  if (!title) {
    return 'Cannot save memory: title is required.'
  }
  if (!summary) {
    return 'Cannot save memory: summary is required.'
  }

  const validTypes: WhisphryMemoryType[] = ['note', 'fact', 'task', 'insight']
  if (!validTypes.includes(type)) {
    return `Cannot save memory: type must be one of ${validTypes.join(', ')}.`
  }

  // Cooldown gate — reject without persisting if another save just happened.
  const sinceLastMs = Date.now() - lastSaveMemoryAt
  if (lastSaveMemoryAt > 0 && sinceLastMs < SAVE_MEMORY_COOLDOWN_MS) {
    const secsSince = Math.round(sinceLastMs / 1000)
    return (
      `Refused: another memory ("${lastSaveMemoryTitle}") was saved ${secsSince}s ago. ` +
      `Wait at least ${Math.ceil(SAVE_MEMORY_COOLDOWN_MS / 1000)}s before saving again, ` +
      `or the user will feel spammed. If the user explicitly asked for a SECOND save right now, ` +
      `acknowledge in text without calling this tool — explain that you already saved recently.`
    )
  }

  const memory = deps.memoryStore.createMemory({
    type,
    title,
    summary,
    status: 'active',
    confidence: 0.9,
    tags: ['user-requested'],
  })

  deps.memoryStore.append(memory)
  lastSaveMemoryAt = Date.now()
  lastSaveMemoryTitle = title

  return `Memory saved: "${title}" (${type}, id: ${memory.id}).`
}

async function executeAnalyzeCurrentScreen(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  if (!deps.analyzeCurrentScreen) {
    return 'Current screen analysis is not available right now.'
  }

  const question = String(args.question ?? '').trim()
  return await deps.analyzeCurrentScreen(question || undefined)
}

function executeGetSessionContext(deps: ToolExecutorDeps): string {
  const summary = deps.getSessionContextSummary?.().trim()
  if (!summary) {
    return 'No session context summary is available yet.'
  }
  return summary
}


async function executeSearchWeb(deps: ToolExecutorDeps, args: Record<string, any>): Promise<string> {
  if (!deps.searchWeb) {
    return 'Web search is not available right now.'
  }

  const query = String(args.query ?? '').trim()
  if (!query) {
    return 'Cannot search the web: query is required.'
  }

  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined
  const result = await deps.searchWeb(query, limit)
  const lines = result.results.map((item, index) =>
    [
      `${index + 1}. ${item.title}`,
      `   URL: ${item.url}`,
      item.snippet ? `   Snippet: ${item.snippet}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  )

  return [
    `Provider: ${result.provider}`,
    `Query: ${result.query}`,
    '',
    ...lines,
  ].join('\n')
}

async function executeGenerateImage(deps: ToolExecutorDeps, args: Record<string, any>): Promise<string> {
  if (!deps.generateImage) {
    return 'Image generation is not available right now.'
  }

  const prompt = String(args.prompt ?? '').trim()
  if (!prompt) {
    return 'Cannot generate image: prompt is required.'
  }

  const size = String(args.size ?? '').trim() as '1024x1024' | '1536x1024' | '1024x1536' | 'auto' | ''
  const quality = String(args.quality ?? '').trim() as 'auto' | 'low' | 'medium' | 'high' | ''
  const background = String(args.background ?? '').trim() as 'auto' | 'transparent' | 'opaque' | ''
  const result = await deps.generateImage({
    prompt,
    ...(size ? { size } : {}),
    ...(quality ? { quality } : {}),
    ...(background ? { background } : {}),
  })

  return [
    `Generated image artifact: ${result.relativePath}`,
    `Artifact ID: ${result.artifactId}`,
    result.revisedPrompt ? `Revised prompt: ${result.revisedPrompt}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function executeInsertSolutionIntoEditor(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const content = String(args.content ?? '').trim()
  if (!content) {
    return 'Cannot prepare insertion: content is required.'
  }
  if (!deps.copyToClipboard) {
    return 'Clipboard insertion is not available right now.'
  }

  deps.copyToClipboard(content)
  return 'Copied the solution to the clipboard. It is ready to paste into the editor.'
}

async function executeRunCodeAnalysisOnScreen(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  if (!deps.analyzeCurrentScreen) {
    return 'Current screen analysis is not available right now.'
  }

  const question = String(args.question ?? '').trim()
  const groundedPrompt =
    question ||
    'Analyze the code, error messages, stack traces, or technical content currently visible on screen. Describe the concrete problem, likely cause, and any important details without guessing beyond what is visible.'

  return await deps.analyzeCurrentScreen(groundedPrompt)
}

function executeSummarizeCurrentTask(deps: ToolExecutorDeps): string {
  const summary = deps.getCurrentTaskSummary?.().trim() || deps.getSessionContextSummary?.().trim()
  if (!summary) {
    return 'No grounded current-task summary is available yet.'
  }
  return summary
}

async function executePreviewRecentArtifact(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'Cannot preview artifact: query is required.'
  if (!deps.artifactStore || !deps.previewArtifactById) {
    return 'Artifact preview is not available right now.'
  }

  const filters: ArtifactListFilters = {
    limit: 1,
    query,
  }
  if (args.type) filters.types = [args.type]
  if (args.session) filters.sessionFolderName = args.session

  const artifact = deps.artifactStore.listRecent(filters)[0]
  if (!artifact) {
    return `No recent artifact matched "${query}".`
  }

  await deps.previewArtifactById(artifact.id)
  return `Previewed artifact: ${artifact.relativePath || artifact.absolutePath}.`
}

function executeOpenAnswerWindow(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const title = String(args.title ?? '').trim()
  const content = String(args.content ?? '').trim()
  if (!title || !content) {
    return 'Cannot open answer window: title and content are required.'
  }
  if (!deps.openAnswerWindow) {
    return 'Answer window control is not available right now.'
  }

  deps.openAnswerWindow(title, content)
  return `Opened answer window for "${title}".`
}

async function executeSolveWithOpenRouter(deps: ToolExecutorDeps, args: Record<string, any>): Promise<string> {
  const question = String(args.question ?? '').trim()
  if (!question) {
    return 'Cannot delegate to OpenRouter: question is required.'
  }
  if (!deps.solveWithOpenRouter) {
    return 'OpenRouter delegation is not available right now.'
  }

  const result = await deps.solveWithOpenRouter(question)
  return result || `OpenRouter completed the detailed answer for "${question}".`
}

async function executeOpenRecentArtifact(
  deps: ToolExecutorDeps,
  args: Record<string, any>
): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'Cannot open artifact: query is required.'
  if (!deps.artifactStore || !deps.openArtifactById) {
    return 'Artifact opening is not available right now.'
  }

  const filters: ArtifactListFilters = {
    limit: 1,
    query,
  }
  if (args.type) filters.types = [args.type]
  if (args.session) filters.sessionFolderName = args.session

  const artifact = deps.artifactStore.listRecent(filters)[0]
  if (!artifact) {
    return `No recent artifact matched "${query}".`
  }

  await deps.openArtifactById(artifact.id)
  return `Opened artifact: ${artifact.relativePath || artifact.absolutePath}.`
}

function executeSaveAnswerAsMemory(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const latest = deps.getLatestAnswerSnapshot?.()
  if (!latest || !latest.answer.trim()) {
    return 'No recent answer is available to save yet.'
  }

  const requestedType = String(args.type ?? 'insight') as WhisphryMemoryType
  const validTypes: WhisphryMemoryType[] = ['note', 'fact', 'task', 'insight']
  const type = validTypes.includes(requestedType) ? requestedType : 'insight'
  const title = String(args.title ?? '').trim() || latest.question.trim() || 'Saved answer'
  const summary = latest.answer.trim().replace(/\s+/g, ' ').slice(0, 220)

  const memory = deps.memoryStore.createMemory({
    type,
    title,
    summary,
    content: latest.answer,
    status: 'active',
    confidence: 0.92,
    tags: ['answer-snapshot'],
  })

  deps.memoryStore.append(memory)
  return `Saved the latest answer as memory "${title}" (${type}).`
}

function executeShowBubble(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const message = String(args.message ?? '').trim()
  if (!message) return 'Cannot show bubble: message is required.'

  if (!deps.widgetManager) return 'Tool not available yet.'

  const policy = deps.getInterruptionPolicy?.() ?? 'ask-first'
  const msSince = Date.now() - (deps.getLastEventTimestamp?.() ?? 0)
  const resolvedPolicy = resolveAutoPolicy(policy, msSince)
  const check = checkInterruptionPolicy(policy, 'show_bubble', resolvedPolicy)
  if (!check.allowed) return `Bubble suppressed: ${check.reason}`

  const urgency = args.urgency ?? 'low'
  const expandable = args.expandable ?? false

  const widget = deps.widgetManager.register({
    type: 'bubble',
    props: { message, urgency, expandable },
  })

  return `Bubble shown (id: ${widget.id}).`
}

function executeShowPanel(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const title = String(args.title ?? '').trim()
  const content = String(args.content ?? '').trim()
  if (!title || !content) return 'Cannot show panel: title and content are required.'

  if (!deps.widgetManager) return 'Tool not available yet.'

  const policy = deps.getInterruptionPolicy?.() ?? 'ask-first'
  const msSince = Date.now() - (deps.getLastEventTimestamp?.() ?? 0)
  const resolvedPolicy = resolveAutoPolicy(policy, msSince)
  const check = checkInterruptionPolicy(policy, 'show_panel', resolvedPolicy)
  if (!check.allowed) return `Panel suppressed: ${check.reason}`

  const panelType = args.panel_type ?? 'context'

  const widget = deps.widgetManager.register({
    type: 'panel',
    props: { title, content, panelType },
  })

  return `Panel shown: "${title}" (id: ${widget.id}).`
}

function executeShowToast(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const message = String(args.message ?? '').trim()
  if (!message) return 'Cannot show toast: message is required.'

  if (!deps.widgetManager) return 'Tool not available yet.'

  const policy = deps.getInterruptionPolicy?.() ?? 'ask-first'
  const msSince = Date.now() - (deps.getLastEventTimestamp?.() ?? 0)
  const resolvedPolicy = resolveAutoPolicy(policy, msSince)
  const check = checkInterruptionPolicy(policy, 'show_toast', resolvedPolicy)
  if (!check.allowed) return `Toast suppressed: ${check.reason}`

  const widget = deps.widgetManager.register({
    type: 'toast',
    props: { message },
  })

  return `Toast shown (id: ${widget.id}).`
}

function executeDismissWidget(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const widgetId = String(args.widget_id ?? '').trim()
  if (!widgetId) return 'Cannot dismiss: widget_id is required.'

  if (!deps.widgetManager) return 'Tool not available yet.'

  const widget = deps.widgetManager.get(widgetId)
  if (!widget) return `No widget found with id: "${widgetId}".`
  if (!widget.dismissable) return `Widget "${widgetId}" is not dismissable.`

  deps.widgetManager.dismiss(widgetId)
  return `Widget "${widgetId}" dismissed.`
}

async function executeSearchArtifacts(deps: ToolExecutorDeps, args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'No query provided.'

  if (!deps.artifactStore) return 'Tool not available yet.'

  const filters: ArtifactListFilters = {
    limit: 10,
    query,
  }
  if (args.type) filters.types = [args.type]
  if (args.session) filters.sessionFolderName = args.session

  const artifacts = deps.artifactStore.listRecent(filters)

  if (artifacts.length === 0) {
    return `No artifacts found for query: "${query}".`
  }

  const lines = artifacts.map((a, i) =>
    `${i + 1}. [${a.type}] ${a.relativePath || a.absolutePath} (${new Date(a.createdAt).toLocaleDateString()})`
  )

  return `Found ${artifacts.length} artifact(s):\n${lines.join('\n')}`
}
