# 🧠 MCP Memory Server

**Give your AI a brain that never forgets.**

A persistent, cloud-synced memory server for AI assistants using the **Model Context Protocol (MCP)**. Works across Claude, Cursor, Windsurf, VS Code, Gemini CLI — all sharing the same memory in real-time.

> **Use case:** You're building a project in Cursor. You switch to Claude Code. It already knows what Cursor did — your architecture decisions, file changes, preferences — everything. Zero context repetition.

---

## 🚀 One-Command Setup

```bash
git clone https://github.com/prust/mcp-memory-server.git
cd mcp-memory-server
npm install && npm run build
node setup.mjs --user-id=YOUR_NAME
```

The setup script will:
- ✅ Verify your `serviceAccountKey.json`
- ✅ Build the project if needed
- ✅ Print **ready-to-paste configs** for every client

---

## 🔌 Connect Your Client (Pick One)

> Replace `YOUR_PATH` with the absolute path to this folder, and `YOUR_NAME` with your username.

### Claude Code
```bash
claude mcp add memory -- node YOUR_PATH/dist/index.js --user-id=YOUR_NAME
```
That's it. Done. ✅

---

### Claude Desktop
File: `%APPDATA%\Claude\claude_desktop_config.json` (Win) · `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac)

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["YOUR_PATH/dist/index.js", "--user-id=YOUR_NAME"]
    }
  }
}
```

---

### Cursor IDE
**Settings → Features → MCP → + Add new MCP server**

| Field | Value |
|---|---|
| Type | `command` |
| Name | `memory` |
| Command | `node YOUR_PATH/dist/index.js --user-id=YOUR_NAME` |

---

### Windsurf / Codeium
File: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["YOUR_PATH/dist/index.js", "--user-id=YOUR_NAME"]
    }
  }
}
```

---

### VS Code (GitHub Copilot)
File: `.vscode/mcp.json` in your project

```json
{
  "mcp": {
    "servers": {
      "memory": {
        "command": "node",
        "args": ["YOUR_PATH/dist/index.js", "--user-id=YOUR_NAME"]
      }
    }
  }
}
```

---

### Gemini CLI
File: `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["YOUR_PATH/dist/index.js", "--user-id=YOUR_NAME"]
    }
  }
}
```

---

### Any MCP Client (Generic)
The server uses **stdio transport**:
```bash
node YOUR_PATH/dist/index.js --user-id=YOUR_NAME
```

---

## 🗝️ Firebase Setup (First Time Only)

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) → **Create a project**
2. Enable **Build → Firestore Database** → Create in **production mode**
3. **Project Settings** (⚙️) → **Service Accounts** → **Generate new private key**
4. Save the file as **`serviceAccountKey.json`** in the project root

> ⚠️ This file is gitignored. Never commit it.

### Optional: Semantic Search
Add **any one** API key to enable AI-powered similarity search:

```env
# Pick ONE — whichever you already have:
GEMINI_API_KEY=your_key_here          # Free (recommended)
OPENAI_API_KEY=your_key_here          # text-embedding-3-small
COHERE_API_KEY=your_key_here          # embed-english-v3.0

# Optional overrides:
EMBEDDING_PROVIDER=openai             # Force a specific provider
OPENAI_BASE_URL=https://your-api.com  # For Azure, Ollama, LM Studio, etc.
OPENAI_MODEL=text-embedding-3-large   # Custom model name
```

> **Auto-detection:** If no `EMBEDDING_PROVIDER` is set, the server picks the first key it finds (Gemini → OpenAI → Cohere). No key = smart fuzzy search (still works great).

---

## 🧰 All 15 Tools

| Tool | What It Does |
|---|---|
| `add_memory` | Save a new memory with optional tags |
| `get_memory` | Fetch a single memory by ID |
| `get_all_memories` | List memories (paginated, pinned first) |
| `search_memories` | Smart fuzzy search by text and/or tags |
| `semantic_search` | AI-powered similarity search (Gemini embeddings) |
| `update_memory` | Edit an existing memory |
| `delete_memory` | Delete a memory |
| `pin_memory` | Pin/unpin important memories |
| `add_memories` | Bulk add multiple memories at once |
| `delete_memories` | Bulk delete by IDs |
| `link_memories` | Create relationships between memories |
| `unlink_memories` | Remove relationships |
| `export_memories` | Export all memories as JSON |
| `import_memories` | Import memories (merge or replace) |
| `cleanup_expired` | Remove memories past their TTL |

### Example Prompts
```
"Remember that this project uses Next.js 15 with App Router"
→ add_memory(fact: "Project uses Next.js 15 with App Router", tags: ["tech-stack"])

"What do you know about my project setup?"
→ search_memories(query: "project setup")

"Link the auth memory to the API memory"
→ link_memories(sourceId: "abc", targetId: "xyz")
```

---

## 📊 Web Dashboard

**Live at: [mcp-memory-srv-prust.web.app](https://mcp-memory-srv-prust.web.app)**

| Page | Features |
|---|---|
| 📊 Dashboard | Stats, timeline, tag cloud, activity feed |
| 🧠 Memory Explorer | Search, filter, inline edit, pin/delete |
| 🔗 Knowledge Graph | Interactive D3.js force-directed visualization |
| 📤 Import/Export | Download memories as JSON |
| 🔍 Semantic Search | AI search with relevance scoring |
| ⚙️ Settings | Server info, connection guide |

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🔄 **Multi-IDE Sync** | Same memory across Claude, Cursor, Windsurf, VS Code, Gemini CLI |
| 🧠 **Semantic Search** | Find memories by meaning, not just keywords (Gemini AI) |
| 📌 **Pinned Memories** | Prioritize important facts |
| 🔗 **Memory Links** | Connect related memories into a knowledge graph |
| ⏰ **Auto-Expiry (TTL)** | Memories can auto-delete after a set time |
| 📦 **Bulk Operations** | Add/delete many memories at once |
| 📤 **Import/Export** | Full backup and restore |
| 🔐 **User Isolation** | Each `--user-id` gets its own private namespace |
| ☁️ **Cloud Sync** | Real-time sync across all devices |
| 🔄 **Auto-Retry** | Exponential backoff on transient errors |

---

## 📁 Project Structure

```
mcp-memory-server/
├── src/
│   ├── index.ts        # Entry point
│   ├── config.ts       # CLI args + env vars
│   ├── server.ts       # MCP tool registration (15 tools)
│   ├── store.ts        # FirestoreMemoryStore (CRUD + search)
│   ├── embeddings.ts   # Gemini AI embeddings
│   ├── logger.ts       # Structured logger
│   └── types.ts        # TypeScript interfaces
├── dashboard/          # Next.js web dashboard (6 pages)
├── tests/
│   ├── store.test.ts   # 19 unit tests
│   └── smoke.mjs       # Live Firestore smoke test
├── setup.mjs           # One-command setup script
├── serviceAccountKey.json  # (gitignored) Firebase credentials
└── package.json
```

---

## 🧪 Testing

```bash
npm test              # Unit tests (19 tests, all mocked)
node tests/smoke.mjs  # Smoke test against live Firestore
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `USER_ID` | — | Alternative to `--user-id` CLI flag |
| `GEMINI_API_KEY` | — | Gemini embeddings (free, default) |
| `OPENAI_API_KEY` | — | OpenAI embeddings |
| `OPENAI_BASE_URL` | `api.openai.com` | Custom endpoint (Azure, Ollama, LM Studio) |
| `OPENAI_MODEL` | `text-embedding-3-small` | Custom embedding model |
| `COHERE_API_KEY` | — | Cohere embeddings |
| `EMBEDDING_PROVIDER` | auto-detect | Force: `gemini`, `openai`, `cohere` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---|---|
| `Missing serviceAccountKey.json` | Download from Firebase Console → Project Settings → Service Accounts |
| `Missing user authentication` | Add `--user-id=your-name` to the command |
| `PERMISSION_DENIED` | Enable Cloud Firestore API in Google Cloud Console |
| Server disconnected in IDE | Run `npm run build`, restart your IDE |
| Memories not syncing | Ensure all clients use the **same** `--user-id` |

---

## 📄 License

MIT
