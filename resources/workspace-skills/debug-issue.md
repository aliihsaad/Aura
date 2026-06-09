---
id: debug-issue
when: "User reports a bug, regression, broken UI, failing test, error message, or asks to revert/restore a previous working state."
---

# Process

This is the Claude Code / Codex-style debugging loop. Follow it in order — do not skip steps.

## 1. Reproduce / observe the failure
- If the user gave a concrete symptom ("X is broken", "Y throws", "the UI looks wrong"), inspect the actual artifact first:
  - Run the failing command via `run_terminal_command` and read the error.
  - Read the file the user pointed at via `read_workspace_file`.
  - For UI bugs, list and read the relevant component file.
- If the symptom is "regression after recent change", check `git log -n 10 --oneline` to see what changed.

## 2. Locate the root cause
- Use `search_workspace_code` with a keyword from the error message, the user's description, or a symbol name.
- Read every file the search points to, fully or with `start_line`/`end_line`. Do NOT guess.
- For a regression, run `git diff HEAD~1 -- <file>` to see exactly what changed.

## 3. State a hypothesis (one line)
Before any edit, write the hypothesis in your visible output:
- "The cause is X (in file:line) because Y. The fix is Z."
- If you cannot write this, you have not gathered enough evidence — go back to step 2.

## 4. Choose the smallest fix
- Editing one line beats rewriting one function. Rewriting one function beats rewriting a file.
- For "revert to working state": prefer git over manual edits.
  - `git reset --hard <commit>` — full repo to a specific commit. The runtime will ask for fresh approval; that's expected.
  - `git checkout <commit> -- <path>` — single file from a specific commit.
  - `git revert <commit>` — undo a commit while preserving history.

## 5. Apply the fix
- Read the file you are about to edit (the runtime enforces this).
- `write_workspace_file` with the full new body, preserving every unrelated line verbatim.

## 6. Verify with evidence
- The runtime auto-re-reads files you write — read the auto-verify block to confirm the change landed.
- For git ops, the runtime auto-captures HEAD + status — confirm it matches the target commit.
- If you ran a failing command in step 1, run it again now and confirm it passes.
- Final summary: state what changed, the evidence it works, and any caveats.

# Don't

- Don't write a file you have not read in this task. The runtime will refuse the call.
- Don't loop on a permanently refused command (catastrophic block, declined approval). Stop and explain.
- Don't reformat, refactor, or "improve" code outside the bug. That is a separate task.
- Don't claim success based on "Exit code: 0" alone. Read the file or run the failing test.
