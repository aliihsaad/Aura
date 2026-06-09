---
id: modify-existing-feature
when: "User wants to change, extend, refactor, or remove behavior in an existing project (NOT a bug fix — use debug-issue for that)."
---

# Process

## 1. Locate
- `search_workspace_code` for a keyword the user mentioned (function name, user-facing string, error code, route, etc.).
- `list_workspace_files` on relevant directories if the search isn't enough.
- Build a mental map of which files are involved before touching anything.

## 2. Read fully
- `read_workspace_file` on every candidate file. For large files use `start_line`/`end_line` and target the relevant region.
- Note related files (callers, tests, types) — a change in one place often needs a matching change elsewhere.

## 3. Plan the smallest set of edits
Write a one-line plan in your visible output:
- "I will change A in file:line, and B in file:line, to achieve <goal>."
- If you find yourself planning to edit 5+ files for a "small change," stop and re-read — you may be missing an abstraction that already exists.

## 4. Edit
- Read each file immediately before writing to it (the runtime enforces this).
- Use `write_workspace_file` with the full new body; preserve every unrelated line verbatim.
- One file at a time. After each write, read the auto-verify block before moving on.

## 5. Verify
- The runtime auto-re-reads each written file. Confirm the diff matches your intent.
- If there are tests, run them via `run_terminal_command`.
- If the change is user-visible, describe how to manually check it.

# Pre-write checklist (run through this before EVERY write)

- [ ] Have I read this exact file in this task?
- [ ] Do I know which symbol/line is wrong or missing?
- [ ] Is this the smallest possible change?
- [ ] Am I preserving every unrelated line verbatim?
- [ ] Do I have evidence (not just intuition) that this fix is correct?

# Safety

- Never delete files unless the user explicitly asked.
- Never run terminal commands the task does not require.
- Don't reformat, rename, or "tidy up" code outside the change — that's noise that hides real diffs.
- If the user says "the UI broke" or "revert this" — switch to the `debug-issue` skill instead.
