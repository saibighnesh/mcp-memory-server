# 🚀 OmniBrain MCP: Detailed Feature Guide

This guide provides an in-depth look at the capabilities of OmniBrain MCP and how to leverage them effectively.

---

## 🏗️ Core Architecture
The server uses **Firebase Firestore** as its backbone, providing a cloud-synced, real-time database that acts as a "Shared Brain" across multiple AI clients (Cursor, Claude, VS Code, etc.). 

### The Namespace System (`--user-id`)
Your memories are isolated by your `User ID`. 
- **Privacy:** Different IDs cannot see each other's memories.
- **Sync:** Use the same ID in Cursor and Claude Desktop to share the same knowledge pool instantly.

---

## 🔍 Search Capabilities
The server provides three distinct ways to find information, moving from simple keywords to deep semantic understanding.

### 1. Smart Fuzzy Search (`search_memories`)
Uses a custom scoring algorithm that tokenizes your query and matches it against facts and tags.
- **Best for:** When you remember specific keywords.
- **Scoring:** Exact matches get a score of 1.0. Partial matches and tag matches contribute to a weighted relevance score.
- **Usage:** `search_memories(query: "nextjs api")`

### 2. Semantic Search (`semantic_search`)
*Requires `GEMINI_API_KEY` or `OPENAI_API_KEY`.*
Uses AI Embeddings to find memories based on **meaning**, even if the words don't match.
- **Best for:** Natural language questions like "How did we decide to handle errors?".
- **Concept:** It converts your query into a vector (a list of numbers representing "meaning") and finds the closest vectors in the database.
- **Usage:** `semantic_search(query: "deployment strategy")`

### 3. Tag Filtering
Every memory can have multiple tags.
- **Best for:** Organizing memories by project, technology, or category.
- **Usage:** `search_memories(tags: ["frontend", "refactor"])`

---

## 🔗 Knowledge Graph (`link_memories`)
Unlike a flat list of notes, this server allows you to connect memories.
- **Bidirectional Links:** Linking Memory A to Memory B automatically links B to A.
- **Contextual Retrieval:** When you fetch a memory using `get_memory`, the server automatically retrieves all "Related Memories."
- **Example:**
  1. `add_memory(fact: "Project X uses Postgres", tags: ["db"])` -> ID: `abc`
  2. `add_memory(fact: "Database password is 'password123'", tags: ["secret"])` -> ID: `xyz`
  3. `link_memories(id1: "abc", id2: "xyz")`
  Now, asking about "Project X" will also surface the linked password memory.

---

## 📌 Priority Management (`pin_memory`)
Some facts are more important than others.
- **Pinned First:** Pinned memories always appear at the top of results in `get_all_memories`.
- **Global Context:** Use this for architectural rules, coding standards, or project constraints that the AI should *always* be aware of.
- **Usage:** `pin_memory(id: "document_id")` or `add_memory(..., pinned: true)`

---

## ⏰ Temporary Memories (`ttl_hours`)
Not all memories need to be permanent. You can set a "Time To Live" in hours.
- **Self-Cleaning:** The memory will be ignored after the time expires and can be permanently deleted using `cleanup_expired`.
- **Use Case:** "Remember that I'm working on the 'feature/login' branch today."
- **Usage:** `add_memory(fact: "Working on login branch", ttl_hours: 8)`

---

## 📦 Bulk Operations
Designed for performance when migrating data or setting up a new project.
- **`add_memories`**: Add up to 20 facts in a single request.
- **`delete_memories`**: Remove multiple IDs at once.
- **`export_memories` / `import_memories`**: Perfect for backups or moving data between different Firebase projects.

---

## 🛠️ Tool-by-Tool Reference

| Tool | Parameters | Expert Tip |
|---|---|---|
| `add_memory` | `fact`, `tags`, `pinned`, `ttl_hours` | Use descriptive facts. Include "How" and "Why", not just "What". |
| `get_memory` | `id` | Use this to see the "Knowledge Graph" connections for a specific fact. |
| `get_all_memories` | `limit`, `offset` | Great for a "Review" session of what the AI knows. |
| `search_memories` | `query`, `tags` | You can combine both to search for "React" facts within the "Project X" tag. |
| `update_memory` | `id`, `fact`, `tags`, `pinned` | If you update the `fact`, the server automatically re-generates AI embeddings. |
| `delete_memory` | `id` | Use this when a fact becomes obsolete or incorrect. |
| `memory_stats` | (none) | Check how many memories you've accumulated. |
| `link_memories` | `id1`, `id2` | The "secret sauce" for building a complex project context. |
| `semantic_search` | `query`, `limit` | The most powerful tool for finding "vague" information. |

---

## 💡 Best Practices for Users
1. **Be Specific:** Instead of "The database is Postgres," try "We chose Postgres 16 because of its native Vector support."
2. **Use Tags Religiously:** Tag by project name (`#project-alpha`), layer (`#backend`), and type (`#decision`, `#todo`, `#info`).
3. **Link Decisions to Code:** When you make an architecture decision, save it and link it to the memory about the relevant library.
4. **Prune with TTL:** Use `ttl_hours` for transient state like current branch names or temporary debugging steps to keep your main memory clean.
