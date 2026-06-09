import type { AgentToolInfo } from './types'

export const AGENT_TOOL_CATALOG: AgentToolInfo[] = [
  {
    name: 'recall_memory',
    description: 'Search past memories for relevant context.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'save_memory',
    description: 'Save a piece of information for future reference when explicitly asked.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'get_session_context',
    description: 'Return the app-managed session context summary.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'list_workspace_files',
    description: 'List files and folders inside the current workspace root, especially under projects/, notes/, and plans/.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'search_workspace_code',
    description: 'Search workspace text files for symbols, errors, or implementation details.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'read_workspace_file',
    description: 'Read a UTF-8 text file from the current workspace root.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'write_workspace_file',
    description: 'Write UTF-8 text content to a file inside the current workspace root.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'create_workspace_directory',
    description: 'Create a directory inside the current workspace root, usually under projects/, notes/, or plans/.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'run_terminal_command',
    description: 'Run a workspace-scoped terminal command after explicit user approval.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'search_web',
    description: 'Search the public web for current information and source links.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt and save it as an artifact.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'analyze_workspace_code',
    description: 'Inspect workspace files deeply to find code, docs, notes, or plans relevant to a technical question.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'analyze_current_screen',
    description: 'Capture and inspect the user\'s current screen.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'show_bubble',
    description: 'Display a small proactive message to the user.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'show_panel',
    description: 'Open a content panel with detailed information.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'show_toast',
    description: 'Flash a brief status notification.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'dismiss_widget',
    description: 'Close a specific widget by its ID.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'search_artifacts',
    description: 'Search saved artifacts like screenshots, transcripts, and files.',
    scope: 'core',
    locked: true,
  },
  {
    name: 'insert_solution_into_editor',
    description: 'Copy code or text to the clipboard so it is ready to paste into the editor.',
    scope: 'live-only',
  },
  {
    name: 'run_code_analysis_on_screen',
    description: 'Analyze code, errors, stack traces, or editor content visible on the current screen.',
    scope: 'live-only',
  },
  {
    name: 'summarize_current_task',
    description: 'Return a grounded summary of what the user appears to be working on right now.',
    scope: 'live-only',
  },
  {
    name: 'preview_recent_artifact',
    description: 'Preview the most relevant recent artifact inside the app preview window.',
    scope: 'live-only',
  },
  {
    name: 'open_answer_window',
    description: 'Open the main answer window with a detailed response.',
    scope: 'live-only',
  },
  {
    name: 'solve_with_openrouter',
    description: 'Hand a complex request to the stronger OpenRouter reasoning path.',
    scope: 'live-only',
  },
  {
    name: 'open_recent_artifact',
    description: 'Open the most relevant recent artifact externally.',
    scope: 'live-only',
  },
  {
    name: 'save_answer_as_memory',
    description: 'Save the latest answer-window output as a memory.',
    scope: 'live-only',
  },
]
