# Whisphry Workspace Agent Logic

## Core Principle

**Speech Agent talks. Execution Agent acts.**

The system separates communication from execution to ensure safety, clarity, and scalability.

---

## 1. Roles

### Speech Agent
- Listens to user voice
- Interprets intent
- Checks execution status
- Submits or queues requests
- Provides real-time updates

**Allowed Tools:**
- `get_execution_status()`
- `submit_workspace_request(request)`
- `cancel_current_task()`
- `pause_queue()`
- `resume_queue()`
- `get_execution_logs()`

**Not allowed:**
- File writes
- Terminal commands
- Direct execution

---

### Execution Agent
- Plans tasks
- Selects skills
- Manages queue
- Requests approvals
- Executes tools
- Logs everything
- Verifies results

---

## 2. System Flow


User speaks
→ Speech Agent detects intent
→ Checks execution status
→ If idle: submit request
→ If busy: queue request
→ Execution Agent receives task
→ Selects skill
→ Creates plan
→ Plan Mode decides execution
→ Steps added to queue
→ Approval required for sensitive actions
→ Execute after approval
→ Log results
→ Verify outcome
→ Speech Agent reports back


---

## 3. Execution State

```ts
type ExecutionStatus =
  | "idle"
  | "planning"
  | "queued"
  | "waiting_for_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";
type WorkspaceExecutionState = {
  status: ExecutionStatus;
  currentTask: WorkspaceTask | null;
  queue: WorkspaceTask[];
  activeApproval: ApprovalRequest | null;
  logs: AgentLogEntry[];
  planMode: "plan_only" | "plan_and_execute";
  selectedSkill?: string;
};
4. Task Queue
type WorkspaceTask = {
  id: string;
  request: string;
  source: "voice" | "chat" | "ui" | "system";
  status: "pending" | "planning" | "waiting" | "executing" | "done" | "failed" | "cancelled";
  createdAt: number;
  plan?: ExecutionPlan;
  skillId?: string;
};

Rules:

Only one active task at a time
New tasks are queued
Tasks execute sequentially
5. Plan Mode
Plan Only
Generates steps
No execution
Plan + Execute
Generates plan
Converts steps into queued actions
Executes step-by-step with approval
6. Workspace Skills

Reusable instruction packs used during planning.

Examples:

inspect-workspace
create-small-html-css-js-project
modify-existing-feature
debug-visible-browser-app
add-game-mechanic
safe-refactor

Skill structure:

# Skill: Modify Existing Feature

When to use:
- Modify existing functionality

Process:
1. Inspect files
2. Identify logic
3. Apply minimal change
4. Preserve behavior

Safety:
- Avoid overwrites
- Prefer incremental edits
7. Approval Gate

Protected actions require approval:

write_workspace_file
run_terminal_command
delete_file
rename_file
install_dependency

Flow:

Tool request
→ Pause execution
→ Show approval UI
→ Accept / Decline / Always Allow
→ Continue or cancel
8. Approval Result
// Approved
{ ok: true, approved: true, result }

// Denied
{ ok: false, denied: true, reason }
9. Always Allow Policy

Scoped permissions:

type ApprovalPolicy = {
  scope: "session";
  toolName: string;
  workspacePath: string;
};
10. Logging System
type AgentLogEntry = {
  id: string;
  timestamp: number;
  taskId?: string;
  level: "info" | "success" | "warning" | "error";
  phase:
    | "received"
    | "planning"
    | "skill_selection"
    | "queued"
    | "approval"
    | "execution"
    | "verification"
    | "completed"
    | "failed";
  message: string;
  toolName?: string;
  filePath?: string;
};

Example Logs:

[received] Voice request: Add speed counter
[skill_selection] modify-existing-feature
[planning] 3-step plan created
[approval] Waiting to modify script.js
[execution] File updated
[verification] Refresh required
[completed] Task done
11. Speech Agent Behavior
Idle

"Execution agent is idle. Sending task."

Busy

"Currently modifying script.js. I’ll queue your request."

Waiting Approval

"Waiting for your approval to modify script.js."

Failed

"Task failed. I can retry or adjust."

12. Tool Ownership
Speech Agent
Status
Queue control
Request submission
Logs
Execution Agent
File operations
Terminal commands
Code analysis
Workspace changes
13. Verification

After execution:

Re-read file
Confirm change exists
Validate behavior
Suggest user refresh or test
14. UI Requirements

Display:

Execution status
Current task
Queue count
Selected skill
Logs
Approval UI with diff preview
15. Mode Boundaries
Workspace Mode

✔ Full execution system enabled

Interview Mode

✖ No file execution

Presentation Mode

✖ No execution / silent assistance only

16. Final Summary
Listen
→ Check Status
→ Queue
→ Plan
→ Approve
→ Execute
→ Log
→ Verify
→ Report
Key Concept

Whisphry is not just an assistant.

It is:

A controlled, stateful AI execution system with voice as its interface.