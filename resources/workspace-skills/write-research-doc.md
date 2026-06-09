---
id: write-research-doc
when: "User wants a research document, technical brief, comparison writeup, or analysis assembled in markdown inside a notes or research folder."
---

# Process

1. Decide the destination path: typically `notes/<topic>.md` or `research/<topic>.md`.
2. If the topic needs current information, call search_web for up to 3 targeted queries.
3. Draft the document with this structure:
   - `# Title`
   - `## TL;DR` — 2–3 sentences
   - `## Background` — context the reader needs
   - `## Findings` — main points with sub-headings
   - `## Sources` — bullet list of URLs (if any)
4. Write the document via write_workspace_file.
5. Summarize the final structure and word count.

# Safety
- Cite sources accurately. Do not invent URLs.
- Stay within the workspace; do not download files.
