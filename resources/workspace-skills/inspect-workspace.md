---
id: inspect-workspace
when: "User wants a survey of what's in the workspace, or asks 'what's here', 'what have I got', 'show me my projects'."
---

# Process

1. Call list_workspace_files on the workspace root.
2. For each subdirectory, list its top-level contents.
3. Read README.md, plan.md, or agent.md if present in each project folder.
4. Produce a concise summary: project name, one-line purpose, last-modified hint.

# Safety
- Read-only. Do not write or delete anything.
