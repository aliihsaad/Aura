import { EventEmitter } from 'events'
import { OPENROUTER_BASE_URL } from '@shared/constants'
import {
  type LlmEndpoint,
  type LlmRoutingConfig,
  openRouterEndpoint,
  shouldFallbackAfterStatus,
} from './llm-routing'
import {
  LLMRequest,
  TranscriptEntry,
  UserContext,
  ProfileContext,
  SessionContext,
  SessionIntent,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutorFn,
} from '@shared/types'
import {
  buildSystemPrompt,
  buildAgentSystemPrompt,
  buildQuestionPrompt,
  buildScreenCapturePrompt,
  buildQuestionNormalizationPrompt,
  buildResumeAnalysisPrompt,
} from '@shared/prompts'
import { isExternalAudioEntry, isSelfAuthoredEntry } from '@shared/session-intent-policy'
import type { VisionCortexInput } from './local-ai/providers/vision-provider'

const SINGLE_RUN_TOOLS = new Set([
  'generate_image',
  'run_terminal_command',
])

// OpenRouter forwards `cache_control: { type: 'ephemeral' }` markers to
// providers that support prompt caching (Anthropic, Google Gemini). For
// other providers we keep the system content as a plain string so we
// don't inflate request bodies with a structure they ignore.
const MIN_CACHEABLE_PROMPT_CHARS = 1024
function supportsPromptCaching(model: string): boolean {
  return model.startsWith('anthropic/') || model.startsWith('google/')
}
function buildCacheableSystemContent(text: string, model: string): any {
  if (!text || text.length < MIN_CACHEABLE_PROMPT_CHARS) return text
  if (!supportsPromptCaching(model)) return text
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

const WORKSPACE_MUTATION_REQUIRED_TOOLS = new Set([
  'analyze_current_screen',
  'list_workspace_files',
  'search_workspace_code',
  'read_workspace_file',
  'write_workspace_file',
  'create_workspace_directory',
  'analyze_workspace_code',
])

export class LLMService extends EventEmitter {
  private apiKey: string
  private model: string
  private routing: LlmRoutingConfig
  private abortController: AbortController | null = null
  private heartbeatAbortController: AbortController | null = null
  private readonly incompleteQuestionToken = 'WAITING_FOR_MORE_CONTEXT'

  constructor(apiKey: string, model: string, routing?: LlmRoutingConfig) {
    super()
    this.apiKey = apiKey
    this.model = model
    this.routing = routing?.endpoints.length
      ? routing
      : { endpoints: apiKey ? [openRouterEndpoint(apiKey, model)] : [] }
  }

  setModel(model: string): void {
    this.model = model
    this.routing = {
      endpoints: this.routing.endpoints.map((endpoint) =>
        endpoint.tracksModelSelection
          ? {
              ...endpoint,
              model,
            }
          : endpoint
      ),
    }
  }

  async generateAnswer(request: LLMRequest): Promise<void> {
    this.abort()
    this.abortController = new AbortController()

    const basePrompt = buildSystemPrompt(
      request.userContext,
      request.interviewType,
      request.fileContext,
      request.recallContext,
      request.answerLanguage
    )
    const systemPrompt = (request.soulPrompt || request.personalityFragment)
      ? buildAgentSystemPrompt(
          request.soulPrompt || '',
          request.personalityFragment || '',
          basePrompt
        )
      : basePrompt
    const userPrompt = buildQuestionPrompt(
      request.question,
      request.userContext.sessionIntent || 'interview'
    )

    const messages: Array<{ role: string; content: any }> = [
      { role: 'system', content: systemPrompt },
    ]

    // Add previous Q&A pairs so the LLM has conversation memory
    if (request.answerHistory && request.answerHistory.length > 0) {
      // Include last 10 Q&A pairs to stay within context limits
      const recentAnswers = request.answerHistory.slice(-10)
      for (const snapshot of recentAnswers) {
        messages.push({ role: 'user', content: snapshot.question })
        messages.push({ role: 'assistant', content: snapshot.answer })
      }
    }

    // Add recent transcript fragments for speech context
    const recentHistory = request.conversationHistory
      .filter((e) => e.isFinal)
      .slice(-10)

    for (const entry of recentHistory) {
      messages.push({
        role: entry.speaker === 'user' ? 'assistant' : 'user',
        content: entry.text,
      })
    }

    const toolChoiceMode = request.toolChoiceMode || 'auto'
    messages.push({ role: 'user', content: userPrompt })

    await this.callOpenRouter(
      messages,
      toolChoiceMode === 'required-until-workspace-mutation' ? 0.2 : 0.7,
      toolChoiceMode === 'required-until-workspace-mutation' ? 4096 : 1024,
      request.tools,
      request.executeToolCall,
      toolChoiceMode === 'required-until-workspace-mutation' ? 6 : 3,
      new Set<string>(),
      new Set<string>(),
      toolChoiceMode
    )
  }

  async analyzeScreenshot(
    imageBase64: string,
    context: UserContext | ProfileContext,
    session?: SessionContext,
    recallContext?: string,
    answerLanguage?: string,
    question?: string
  ): Promise<void> {
    this.abort()
    this.abortController = new AbortController()

    const sessionIntent = session?.sessionIntent || readSessionIntentFromContext(context)
    const systemPrompt = session
      ? buildSystemPrompt(context as ProfileContext, { ...session, interviewType: 'coding' }, undefined, recallContext, answerLanguage)
      : buildSystemPrompt(context as UserContext, 'coding', undefined, recallContext, answerLanguage)

    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildScreenCapturePrompt(question, sessionIntent) },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageBase64}`,
            },
          },
        ],
      },
    ]

    await this.callOpenRouter(
      messages,
      0.3,
      2048,
      undefined,
      undefined,
      3,
      new Set<string>(),
      new Set<string>(),
      'auto',
      'openrouter-only'
    )
  }

  async analyzeScreenshotOnce(
    imageBase64: string,
    context: UserContext | ProfileContext,
    session?: SessionContext,
    recallContext?: string,
    answerLanguage?: string,
    question?: string
  ): Promise<string> {
    const sessionIntent = session?.sessionIntent || readSessionIntentFromContext(context)
    const systemPrompt = session
      ? buildSystemPrompt(context as ProfileContext, { ...session, interviewType: 'coding' }, undefined, recallContext, answerLanguage)
      : buildSystemPrompt(context as UserContext, 'coding', undefined, recallContext, answerLanguage)

    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildScreenCapturePrompt(question, sessionIntent) },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageBase64}`,
            },
          },
        ],
      },
    ]

    return this.callOpenRouterOnce(messages, 0.2, 1536)
  }

  async normalizeQuestion(
    question: string,
    conversationHistory: TranscriptEntry[],
    options: { sessionIntent?: SessionIntent } = {}
  ): Promise<string> {
    const recentTranscript = getRecentNormalizationContextEntries(
      conversationHistory,
      options.sessionIntent || 'interview'
    )
      .map((entry) => entry.text.trim())
      .join('\n')

    const response = await this.callRoutedChatOnce(
      [
        {
          role: 'system',
          content: 'You rewrite noisy transcript fragments into one clean prompt or request. Output only the rewritten text.',
        },
        {
          role: 'user',
          content: buildQuestionNormalizationPrompt(question, recentTranscript),
        },
      ],
      0.1,
      96
    )

    return response.trim()
  }

  async analyzeResume(content: { text?: string; pdfBase64?: string }): Promise<string> {
    const prompt = buildResumeAnalysisPrompt()
    const userContent: any[] = []

    if (content.pdfBase64) {
      // Send PDF as document via data URL with application/pdf mime type
      userContent.push({ type: 'text', text: prompt })
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:application/pdf;base64,${content.pdfBase64}` },
      })
    } else if (content.text) {
      userContent.push({ type: 'text', text: `${prompt}\n\n---\n\nRaw resume text:\n\n${content.text}` })
    } else {
      throw new Error('No resume content provided')
    }

    return this.callOpenRouterOnce(
      [
        { role: 'system', content: 'You structure resumes into clean markdown for the Whisphry app.' },
        { role: 'user', content: userContent },
      ],
      0.2,
      4096
    )
  }

  private async requestChatCompletion(args: {
    body: Record<string, unknown> | ((endpoint: LlmEndpoint) => Record<string, unknown>)
    signal?: AbortSignal
    purpose: string
  }): Promise<{ response: Response; endpoint: LlmEndpoint }> {
    if (this.routing.endpoints.length === 0) {
      throw new Error('No LLM provider configured')
    }

    let lastError: Error | null = null
    for (let index = 0; index < this.routing.endpoints.length; index++) {
      const endpoint = this.routing.endpoints[index]!
      const hasFallback = index < this.routing.endpoints.length - 1
      let response: Response
      try {
        const requestBody =
          typeof args.body === 'function' ? args.body(endpoint) : args.body
        response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
            'Content-Type': 'application/json',
            ...endpoint.headers,
          },
          body: JSON.stringify({
            ...requestBody,
            model: endpoint.model,
          }),
          signal: args.signal,
        })
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error
        lastError = error instanceof Error ? error : new Error(String(error))
        this.logEndpointFailure(endpoint, args.purpose, lastError, hasFallback)
        continue
      }

      if (response.ok) return { response, endpoint }

      const errorText = await response.text()
      const error = new Error(`${endpoint.label} ${args.purpose} error ${response.status}: ${errorText}`)
      lastError = error
      if (!shouldFallbackAfterStatus(response.status)) throw error

      this.logEndpointFailure(endpoint, args.purpose, error, hasFallback)
    }

    throw lastError || new Error(`No LLM provider returned a response for ${args.purpose}`)
  }

  private buildMessagesForEndpoint<T extends { role: string; content: any }>(
    messages: T[],
    endpoint: LlmEndpoint
  ): T[] {
    const first = messages[0]
    if (
      endpoint.id !== 'openrouter' ||
      !first ||
      first.role !== 'system' ||
      typeof first.content !== 'string'
    ) {
      return messages
    }

    return [
      {
        ...first,
        content: buildCacheableSystemContent(first.content, endpoint.model),
      },
      ...messages.slice(1),
    ]
  }

  private logEndpointFailure(
    endpoint: LlmEndpoint,
    purpose: string,
    error: Error,
    hasFallback: boolean
  ): void {
    const action = hasFallback ? 'trying fallback' : 'no fallback remains'
    console.warn(`[LLM] ${endpoint.label} failed for ${purpose}; ${action}:`, error.message)
  }

  private async requestOpenRouterChatCompletion(args: {
    body: Record<string, unknown>
    signal?: AbortSignal
    purpose: string
  }): Promise<Response> {
    // Non-companion helper remains OpenRouter-only until provider support is verified for this path.
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Whisphry',
      },
      body: JSON.stringify({
        ...args.body,
        model: this.model,
      }),
      signal: args.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter ${args.purpose} error ${response.status}: ${errorText}`)
    }

    return response
  }

  private async callOpenRouter(
    messages: Array<{ role: string; content: any; tool_calls?: any[] }>,
    temperature: number,
    maxTokens: number,
    tools?: ToolDefinition[],
    executeToolCall?: ToolExecutorFn,
    remainingToolIterations = 3,
    executedSingleRunTools = new Set<string>(),
    executedToolNames = new Set<string>(),
    toolChoiceMode: 'auto' | 'required-until-workspace-mutation' = 'auto',
    providerMode: 'routed' | 'openrouter-only' = 'routed'
  ): Promise<void> {
    try {
      const availableTools =
        tools && tools.length > 0 && executeToolCall && remainingToolIterations > 0
          ? filterAvailableTools(tools, executedSingleRunTools, toolChoiceMode, executedToolNames)
          : []
      const requireToolCall =
        toolChoiceMode === 'required-until-workspace-mutation' &&
        !hasExecutedWorkspaceMutation(executedToolNames) &&
        availableTools.length > 0
      const shouldBufferToolRoutingContent =
        toolChoiceMode === 'required-until-workspace-mutation' &&
        !hasExecutedWorkspaceMutation(executedToolNames)

      const body = (endpoint: LlmEndpoint) => ({
        messages: this.buildMessagesForEndpoint(messages, endpoint),
        stream: true,
        temperature,
        max_tokens: maxTokens,
        ...(availableTools.length > 0
          ? {
              tools: availableTools,
              ...(requireToolCall ? { tool_choice: 'required' } : {}),
            }
          : {}),
      })

      const response =
        providerMode === 'routed'
          ? (
              await this.requestChatCompletion({
                purpose: 'stream',
                signal: this.abortController!.signal,
                body,
              })
            ).response
          : await this.requestOpenRouterChatCompletion({
              purpose: 'stream',
              signal: this.abortController!.signal,
              body: body(openRouterEndpoint(this.apiKey, this.model)),
            })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body reader')

      const decoder = new TextDecoder()
      let fullAnswer = ''
      let lineBuffer = ''
      const toolCalls: ToolCallRequest[] = []
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        lineBuffer += decoder.decode(value, { stream: true })
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() || '' // Keep incomplete last line for next iteration

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            streamDone = true
            break
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            const content = delta?.content
            if (content) {
              fullAnswer += content
              if (!shouldBufferToolRoutingContent) {
                this.emit('chunk', content, fullAnswer)
              }
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = { id: '', function: { name: '', arguments: '' } }
                  }
                  if (tc.id) toolCalls[tc.index].id = tc.id
                  if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
                  if (tc.function?.arguments)
                    toolCalls[tc.index].function.arguments += tc.function.arguments
                }
              }
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
        if (streamDone) break
      }

      // Handle tool calls or emit final answer
      const validToolCalls = toolCalls.filter((tc) => tc && tc.id && tc.function.name)
      if (
        toolChoiceMode === 'required-until-workspace-mutation' &&
        !hasExecutedWorkspaceMutation(executedToolNames) &&
        validToolCalls.length === 0
      ) {
        if (availableTools.length > 0 && remainingToolIterations > 0) {
          messages.push({
            role: 'assistant',
            content: fullAnswer || 'No tool call emitted.',
          })
          messages.push({
            role: 'user',
            content:
              'You must execute this workspace-change request using tools now. Do not answer with a plan, summary, code snippet, or confirmation. Call analyze_current_screen/list_workspace_files/search_workspace_code/read_workspace_file if you need context, then call write_workspace_file or create_workspace_directory. The app will handle write approval.',
          })
          await this.callOpenRouter(
            messages,
            0.1,
            maxTokens,
            tools,
            executeToolCall,
            remainingToolIterations - 1,
            executedSingleRunTools,
            executedToolNames,
            toolChoiceMode,
            providerMode
          )
          return
        }
        this.emitFinalAnswer(
          'I could not apply the workspace change because the selected model did not call the required file-edit tools after multiple attempts. No files were changed. Try again with a stronger tool-capable model.'
        )
        return
      }
      if (validToolCalls.length > 0 && executeToolCall && remainingToolIterations > 0) {
        messages.push({
          role: 'assistant',
          content: fullAnswer || null,
          tool_calls: validToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        })

        for (const tc of validToolCalls) {
          let args: Record<string, any> = {}
          try {
            args = JSON.parse(tc.function.arguments)
          } catch {
            args = {}
          }
          if (SINGLE_RUN_TOOLS.has(tc.function.name) && executedSingleRunTools.has(tc.function.name)) {
            messages.push({
              role: 'tool',
              content: `Tool "${tc.function.name}" was already executed for this answer. Duplicate execution was blocked.`,
              tool_call_id: tc.id,
            } as any)
            continue
          }

          const result = await executeToolCall(tc.function.name, args)
          executedToolNames.add(tc.function.name)
          if (SINGLE_RUN_TOOLS.has(tc.function.name)) {
            executedSingleRunTools.add(tc.function.name)
          }
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id } as any)
        }

        // Follow-up with a bounded tool budget so the model can do useful
        // multi-step work (for example list -> read -> answer) without looping.
        fullAnswer = ''
        await this.callOpenRouter(
          messages,
          temperature,
          maxTokens,
          tools,
          executeToolCall,
          remainingToolIterations - 1,
          executedSingleRunTools,
          executedToolNames,
          toolChoiceMode,
          providerMode
        )
        return
      }

      this.emitFinalAnswer(fullAnswer)
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[LLM] Generation aborted')
        return
      }
      console.error('[LLM] Error:', error.message)
      this.emit('error', error)
    }
  }

  private async callOpenRouterOnce(
    messages: Array<{ role: string; content: any }>,
    temperature: number,
    maxTokens: number
  ): Promise<string> {
    const response = await this.requestOpenRouterChatCompletion({
      purpose: 'single-shot',
      body: {
        messages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
      },
    })

    const parsed = await response.json()
    return parsed.choices?.[0]?.message?.content?.trim?.() || ''
  }

  private async callRoutedChatOnce(
    messages: Array<{ role: string; content: any }>,
    temperature: number,
    maxTokens: number
  ): Promise<string> {
    const { response } = await this.requestChatCompletion({
      purpose: 'single-shot',
      body: (endpoint) => ({
        messages: this.buildMessagesForEndpoint(messages, endpoint),
        stream: false,
        temperature,
        max_tokens: maxTokens,
      }),
    })

    const parsed = await response.json()
    return parsed.choices?.[0]?.message?.content?.trim?.() || ''
  }

  async callJsonOnce(args: {
    systemPrompt: string
    userPrompt: string
    temperature: number
    maxTokens: number
  }): Promise<string> {
    return this.callRoutedChatOnce(
      [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userPrompt },
      ],
      args.temperature,
      args.maxTokens
    )
  }

  async callTextOnce(args: {
    systemPrompt: string
    userPrompt: string
    temperature: number
    maxTokens: number
  }): Promise<string> {
    return this.callRoutedChatOnce(
      [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userPrompt },
      ],
      args.temperature,
      args.maxTokens
    )
  }

  async runWorkspaceExecutor(args: {
    systemPrompt: string
    userPrompt: string
    tools: ToolDefinition[]
    executor: ToolExecutorFn
    maxIterations: number
    temperature: number
    maxTokens: number
    signal?: AbortSignal
  }): Promise<{ toolCallsExecuted: number; finalText: string }> {
    const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ]
    let remaining = args.maxIterations
    let toolCallsExecuted = 0
    let finalText = ''
    while (remaining > 0) {
      if (args.signal?.aborted) return { toolCallsExecuted, finalText }
      // Non-companion helper remains OpenRouter-only until provider support is verified for this path.
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Whisphry',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          temperature: args.temperature,
          max_tokens: args.maxTokens,
          tools: args.tools.length > 0 ? args.tools : undefined,
          ...(args.tools.length > 0 && toolCallsExecuted === 0 ? { tool_choice: 'required' } : {}),
        }),
        signal: args.signal,
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OpenRouter executor error ${response.status}: ${text}`)
      }
      const parsed = await response.json()
      const choice = parsed.choices?.[0]
      const message = choice?.message || {}
      const toolCalls = message.tool_calls || []
      if (!toolCalls.length) {
        finalText = String(message.content || '')
        return { toolCallsExecuted, finalText }
      }
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls,
      })
      for (const tc of toolCalls) {
        let parsedArgs: Record<string, any> = {}
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}')
        } catch {
          parsedArgs = {}
        }
        const result = await args.executor(tc.function.name, parsedArgs, args.signal)
        toolCallsExecuted++
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        } as any)
      }
      remaining--
    }
    return { toolCallsExecuted, finalText }
  }

  async convertPdfToMarkdown(pdfBase64: string, filename: string): Promise<string> {
    return this.callOpenRouterOnce(
      [
        {
          role: 'system',
          content: 'Convert documents to clean, well-structured markdown. Preserve all content, headings, lists, code blocks. Output only markdown.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Convert this PDF ("${filename}") to markdown. Preserve all content.` },
            { type: 'image_url', image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        },
      ],
      0.1,
      8192
    )
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  abortHeartbeat(): void {
    if (this.heartbeatAbortController) {
      this.heartbeatAbortController.abort()
      this.heartbeatAbortController = null
    }
  }

  /**
   * Streaming LLM call used by the heartbeat loop.
   * - Any non-empty content triggers onStreamStart (first token), then onStreamToken
   *   per token, then onStreamEnd when the model finishes.
   * - Tool calls (recall_memory, save_memory, search_artifacts) execute silently;
   *   a follow-up streaming pass then produces the user-visible text.
   * - Does NOT emit chunk/done events on the main EventEmitter bus -- callers
   *   receive everything through the options callbacks.
   */
  async runHeartbeat(
    systemPrompt: string,
    snapshot: string,
    tools: ToolDefinition[],
    executeToolCall: ToolExecutorFn,
    options: {
      maxIterations?: number
      temperature?: number
      maxTokens?: number
      /** Prior alternations from the shared ConversationLog — inserted as
       *  real user/assistant messages so the model sees its own voice and
       *  the user's recent turns as a dialog, not a flat transcript. */
      priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
      onStreamStart?: () => void
      onStreamToken?: (fullText: string, delta: string) => void
      onStreamEnd?: (fullText: string) => void
      onToolCallStart?: (toolNames: string[]) => void
      onUsage?: (usage: { promptTokens: number; completionTokens: number; model: string }) => void
    } = {}
  ): Promise<{ toolCallsExecuted: number; finalText: string }> {
    const {
      maxIterations = 2,
      temperature = 0.3,
      maxTokens = 512,
      priorMessages = [],
      onStreamStart,
      onStreamToken,
      onStreamEnd,
      onToolCallStart,
      onUsage,
    } = options

    this.abortHeartbeat()
    this.heartbeatAbortController = new AbortController()
    const signal = this.heartbeatAbortController.signal

    const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: systemPrompt },
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: snapshot },
    ]

    let toolCallsExecuted = 0
    let finalText = ''

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const { response, endpoint } = await this.requestChatCompletion({
        purpose: 'heartbeat',
        signal,
        body: (endpoint) => ({
          messages: this.buildMessagesForEndpoint(messages, endpoint),
          stream: true,
          temperature,
          max_tokens: maxTokens,
          stream_options: { include_usage: true },
          ...(iteration === 0 && tools.length > 0 ? { tools } : {}),
        }),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body reader')

      const decoder = new TextDecoder()
      let lineBuffer = ''
      let fullText = ''
      let streamStarted = false
      const toolCalls: ToolCallRequest[] = []
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        lineBuffer += decoder.decode(value, { stream: true })
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            streamDone = true
            break
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.usage && onUsage) {
              const u = parsed.usage as { prompt_tokens?: number; completion_tokens?: number }
              onUsage({
                promptTokens: Number(u.prompt_tokens) || 0,
                completionTokens: Number(u.completion_tokens) || 0,
                model: endpoint.model,
              })
            }
            const delta = parsed.choices?.[0]?.delta
            const content = delta?.content
            if (content) {
              fullText += content
              if (!streamStarted && fullText.trim().length > 0) {
                streamStarted = true
                onStreamStart?.()
              }
              if (streamStarted) onStreamToken?.(fullText, content)
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index === undefined) continue
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = { id: '', function: { name: '', arguments: '' } }
                }
                if (tc.id) toolCalls[tc.index].id = tc.id
                if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
                if (tc.function?.arguments)
                  toolCalls[tc.index].function.arguments += tc.function.arguments
              }
            }
          } catch {
            // skip malformed JSON chunks
          }
        }
        if (streamDone) break
      }

      const validToolCalls = toolCalls.filter((tc) => tc && tc.id && tc.function.name)

      if (validToolCalls.length === 0) {
        finalText = fullText
        if (streamStarted) onStreamEnd?.(fullText)
        return { toolCallsExecuted, finalText }
      }

      // Tool calls arrived: execute them, then continue loop for a follow-up
      // streaming pass (without tools) to produce the user-visible text.
      onToolCallStart?.(validToolCalls.map((tc) => tc.function.name))

      messages.push({
        role: 'assistant',
        content: fullText || null,
        tool_calls: validToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      for (const tc of validToolCalls) {
        let args: Record<string, any> = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch {
          args = {}
        }
        const result = await executeToolCall(tc.function.name, args)
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
        toolCallsExecuted++
      }
    }

    return { toolCallsExecuted, finalText }
  }

  private emitFinalAnswer(fullAnswer: string): void {
    const trimmed = fullAnswer.trim()
    if (trimmed === this.incompleteQuestionToken) {
      this.emit('done', '')
      return
    }

    this.emit('done', fullAnswer)
  }

  async cheapTextCompletion(args: {
    systemPrompt: string
    userPrompt: string
    model: string
    jsonSchemaName?: string
    signal?: AbortSignal
    onUsage?: (usage: { promptTokens: number; completionTokens: number; model: string }) => void
  }): Promise<string> {
    // Non-companion helper remains OpenRouter-only until provider support is verified for this path.
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Whisphry',
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: args.userPrompt },
        ],
        response_format: args.jsonSchemaName ? { type: 'json_object' } : undefined,
        temperature: 0.2,
        max_tokens: 1200,
      }),
      signal: args.signal,
    })
    if (!res.ok) throw new Error(`cheapTextCompletion: ${res.status} ${await res.text()}`)
    const data = await res.json()
    if (data?.usage && args.onUsage) {
      const u = data.usage as { prompt_tokens?: number; completion_tokens?: number }
      args.onUsage({
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        model: args.model,
      })
    }
    return data.choices?.[0]?.message?.content ?? ''
  }

  async cheapVisionCompletion(args: {
    systemPrompt: string
    userPrompt: string
    imageBase64Jpeg: string
    model: string
    signal?: AbortSignal
    onUsage?: (usage: { promptTokens: number; completionTokens: number; model: string }) => void
  }): Promise<string> {
    // Non-companion helper remains OpenRouter-only until provider support is verified for this path.
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Whisphry',
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: 'system', content: args.systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: args.userPrompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${args.imageBase64Jpeg}` } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: args.signal,
    })
    if (!res.ok) throw new Error(`cheapVisionCompletion: ${res.status} ${await res.text()}`)
    const data = await res.json()
    if (data?.usage && args.onUsage) {
      const u = data.usage as { prompt_tokens?: number; completion_tokens?: number }
      args.onUsage({
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        model: args.model,
      })
    }
    return data.choices?.[0]?.message?.content ?? ''
  }

  async analyzeVisionCortex(input: VisionCortexInput): Promise<string> {
    const taskLabel = {
      'screen-summary': 'summarize the current screen',
      ocr: 'extract visible text',
      'ui-change': 'identify meaningful UI state changes',
      'answer-context': 'produce compact context for an answer',
    }[input.task]

    return this.callOpenRouterOnce(
      [
        {
          role: 'system',
          content:
            'You are Whisphry vision cortex. Return only JSON with keys: summary, visibleText, uiHints, confidence, shouldEscalate, escalationReason. Keep it compact and factual. Do not invent screen details.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Task: ${taskLabel}.\n` +
                'visibleText must be an array of short strings. uiHints must be an array of UI/layout/action hints. confidence must be low, medium, or high. shouldEscalate is true when a stronger cloud model or raw screenshot is needed.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` },
            },
          ],
        },
      ],
      0.1,
      input.maxTokens
    )
  }
}

function hasExecutedWorkspaceMutation(executedToolNames: Set<string>): boolean {
  return (
    executedToolNames.has('write_workspace_file') ||
    executedToolNames.has('create_workspace_directory')
  )
}

function filterAvailableTools(
  tools: ToolDefinition[],
  executedSingleRunTools: Set<string>,
  toolChoiceMode: 'auto' | 'required-until-workspace-mutation' = 'auto',
  executedToolNames = new Set<string>()
): ToolDefinition[] {
  return tools.filter(
    (tool) =>
      (
        toolChoiceMode !== 'required-until-workspace-mutation' ||
        hasExecutedWorkspaceMutation(executedToolNames) ||
        WORKSPACE_MUTATION_REQUIRED_TOOLS.has(tool.function.name)
      ) &&
      (
        !SINGLE_RUN_TOOLS.has(tool.function.name) ||
        !executedSingleRunTools.has(tool.function.name)
      )
  )
}

function readSessionIntentFromContext(context: UserContext | ProfileContext): SessionIntent {
  const value = (context as Partial<UserContext>).sessionIntent
  return value || 'interview'
}

function getRecentNormalizationContextEntries(
  conversationHistory: TranscriptEntry[],
  sessionIntent: SessionIntent
): TranscriptEntry[] {
  return conversationHistory
    .filter((entry) => {
      if (!entry.isFinal) return false
      if (sessionIntent === 'quick-help') {
        return isSelfAuthoredEntry(entry)
      }
      return isExternalAudioEntry(entry)
    })
    .slice(-4)
}
