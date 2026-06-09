# Whisphry Second Brain Architecture Plan

## 1. Vision
Transform Whisphry into a local autonomous memory agent that:
- captures everything (audio, screen, actions)
- structures it into meaningful memory
- recalls relevant context on demand
- responds via UI, voice, and tools

---

## 2. Core System Layers

### Events
Everything that happens:
- transcript chunks
- screenshots
- user inputs
- tool calls

### Artifacts
Stored assets:
- images
- documents
- transcripts
- generated answers

### Memories
Structured knowledge:
- facts
- notes
- tasks
- insights
- summaries

### Entities
- user (Ali)
- projects
- tools
- routines

### Tools
- save_memory
- recall_memory
- search_artifacts
- speak_text
- show_bubble

---

## 3. Database Schema (Core)

### sessions
Tracks work sessions

### events
All raw activity

### artifacts
Files and outputs

### memories
Structured knowledge

### entities
People, projects, etc.

### entity_attributes
Flexible key-value storage

### memory_links
Relations between memories

### embeddings
Semantic vectors

---

## 4. Memory Pipeline

observe → extract → classify → save → embed → link → recall

---

## 5. Heartbeat Loop

Runs every 10–30 seconds:

- detect important notes
- detect tasks
- detect memories
- assign confidence score
- save accordingly

### Confidence Levels
- low → temporary note
- medium → session memory
- high → long-term memory

---

## 6. Recall System

Ranking uses:
- semantic similarity
- recency
- importance
- tag match
- session match

---

## 7. Screenshot System

Adaptive capture:
- every 10–20 seconds
- on screen change
- on app switch

Includes:
- OCR
- summary
- dedupe (hash comparison)

---

## 8. Voice + Bubble UI

Modes:
- silent
- bubble
- voice

Speech rules:
- no speaking during meetings
- only high-confidence insights
- cooldown between messages

---

## 9. Agent Tool System

The agent does NOT directly modify DB.

Instead it calls tools:

- save_memory
- recall_memory
- search_artifacts
- open_artifact
- speak_text
- show_bubble

---

## 10. Smart Memory Design

Each memory contains:
- title
- summary
- tags
- keywords
- timestamp
- entities
- relations
- importance score

---

## 11. Entities Instead of Dynamic Tables

Instead of creating tables like:
`about_ali`

Use:
- entity: ali
- attributes: preferences, routines
- relations: links to projects/tools

---

## 12. Token Optimization

Use layered context:

### Hot
current task + last messages

### Warm
top recalled memories

### Cold
database (only fetched when needed)

---

## 13. Implementation Phases

### Phase 1
- memory DB
- events + artifacts
- embeddings

### Phase 2
- tool system
- save/recall functions

### Phase 3
- screenshot system
- OCR + summaries

### Phase 4
- voice system
- bubble UI

### Phase 5
- autonomous heartbeat
- proactive recall

---

## 14. Final Goal

A system that behaves like:  

- remembers what matters
- forgets noise
- recalls context instantly
- assists without being intrusive
- acts like a true second brain
