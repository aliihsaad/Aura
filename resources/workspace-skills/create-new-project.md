---
id: create-new-project
when: "User wants to scaffold or start a brand-new project, app, or codebase inside the workspace."
---

# Process

1. Decide the project root folder name from the user request. Slug-case it.
2. Create the project directory under the workspace root.
3. Add these scaffold files in this order:
   - `README.md` — purpose, how to run, status.
   - `plan.md` — goals, milestones, constraints, current state.
   - `agent.md` — system role for any AI assisting this project: tools, conventions, file layout.
   - `.gitignore` — language-appropriate defaults.
   - Language-specific manifest if obvious (`package.json`, `pyproject.toml`, `Cargo.toml`).
4. Stop after the scaffold. Do not start writing actual feature code unless the user asked for it.
5. Summarize what was created and suggest the next concrete step.

# Templates

## plan.md
```
# {{project name}}

## Goals
- {{primary goal}}

## Milestones
- [ ] M1: {{first deliverable}}

## Constraints
- {{any known constraints}}

## Current state
- Project scaffolded on {{date}}.
```

## agent.md
```
# Agent guide for {{project name}}

## Role
You assist with this project's development.

## Conventions
- {{coding style notes}}
- {{testing conventions}}

## Layout
- `README.md`: human-facing summary
- `plan.md`: goals + milestones
- `agent.md`: this file

## Tools
You have read/write access scoped to this project folder via Whisphry workspace tools.
```

# Safety
- Do not overwrite existing files. If a file already exists, skip it and note the skip.
- Keep scaffolds minimal. Prefer creating structure over content.
