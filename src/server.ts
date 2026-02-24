/**
 * MCP server — tool registration and request routing.
 *
 * All database work is delegated to the injected FirestoreMemoryStore.
 * Exposes 15 tools covering CRUD, search, semantic search, pinning,
 * bulk ops, export/import, memory linking, and TTL cleanup.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";
import type { FirestoreMemoryStore } from "./store.js";
import type { EmbeddingService } from "./embeddings.js";
import type { AddMemoryInput, ExportData } from "./types.js";

const MAX_FACT_LENGTH = 10_000;
const SERVER_VERSION = "2.3.0";

// ── Parameter Helpers ───────────────────────────────────────────────

function requireString(args: Record<string, unknown>, key: string): string {
    const value = args?.[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" is required and must be a non-empty string.`);
    }
    return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args?.[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a string.`);
    }
    return value.trim() || undefined;
}

function optionalInt(args: Record<string, unknown>, key: string): number | undefined {
    const value = args?.[key];
    if (value === undefined || value === null) return undefined;
    const num = typeof value === "number" ? value : parseInt(String(value), 10);
    if (isNaN(num) || num < 0) {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a non-negative integer.`);
    }
    return num;
}

function optionalBool(args: Record<string, unknown>, key: string): boolean | undefined {
    const value = args?.[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "boolean") {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" must be a boolean.`);
    }
    return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
    const value = args?.[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" must be an array of strings.`);
    }
    return value.map((v: string) => v.trim().toLowerCase()).filter(Boolean);
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
    const value = args?.[key];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string") || value.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, `"${key}" is required and must be a non-empty array of strings.`);
    }
    return value.map((v: string) => v.trim()).filter(Boolean);
}

function textResponse(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

// ── Tool Definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
    {
        name: "add_memory",
        description: "Add a new memory. Optionally tag, pin, or set a TTL (auto-expiry in hours).",
        inputSchema: {
            type: "object",
            properties: {
                fact: { type: "string", description: "The fact or information to remember (max 10,000 chars)." },
                tags: { type: "array", items: { type: "string" }, description: "Optional tags (e.g. ['project', 'preference'])." },
                pinned: { type: "boolean", description: "Pin this memory so it always appears first (default: false)." },
                ttl_hours: { type: "number", description: "Auto-delete after this many hours. Omit for permanent." },
            },
            required: ["fact"],
        },
    },
    {
        name: "get_memory",
        description: "Retrieve a single memory by ID, including its linked/related memories.",
        inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Memory document ID." } },
            required: ["id"],
        },
    },
    {
        name: "get_all_memories",
        description: "List memories with pagination. Pinned memories always appear first, then newest.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (1-200, default: 50)." },
                offset: { type: "number", description: "Number to skip (default: 0)." },
            },
        },
    },
    {
        name: "search_memories",
        description: "Smart search with relevance scoring. Supports text query, tags, or both. Results include a relevance score (0-1).",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Text to search for (fuzzy word matching with relevance scoring)." },
                tags: { type: "array", items: { type: "string" }, description: "Filter by tags (matches any)." },
            },
        },
    },
    {
        name: "update_memory",
        description: "Update a memory's text, tags, or pinned status.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Memory ID to update." },
                fact: { type: "string", description: "New text (max 10,000 chars). Omit to keep." },
                tags: { type: "array", items: { type: "string" }, description: "New tags. Omit to keep." },
                pinned: { type: "boolean", description: "Set pinned status. Omit to keep." },
            },
            required: ["id"],
        },
    },
    {
        name: "delete_memory",
        description: "Delete a memory by ID.",
        inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Memory ID to delete." } },
            required: ["id"],
        },
    },
    {
        name: "memory_stats",
        description: "Get aggregate stats: total count, oldest and newest timestamps.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "pin_memory",
        description: "Toggle a memory's pinned status. Pinned memories always appear at the top of results.",
        inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Memory ID to pin/unpin." } },
            required: ["id"],
        },
    },
    {
        name: "add_memories",
        description: "Bulk add up to 20 memories in one call. Much faster than calling add_memory repeatedly.",
        inputSchema: {
            type: "object",
            properties: {
                memories: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            fact: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                            pinned: { type: "boolean" },
                            ttl_hours: { type: "number" },
                        },
                        required: ["fact"],
                    },
                    description: "Array of memories to add (max 20).",
                },
            },
            required: ["memories"],
        },
    },
    {
        name: "delete_memories",
        description: "Bulk delete up to 20 memories by ID in one call.",
        inputSchema: {
            type: "object",
            properties: {
                ids: { type: "array", items: { type: "string" }, description: "Memory IDs to delete (max 20)." },
            },
            required: ["ids"],
        },
    },
    {
        name: "export_memories",
        description: "Export all memories as a JSON backup. Use import_memories to restore later.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "import_memories",
        description: "Import memories from a JSON backup. Mode: 'merge' (skip existing) or 'replace' (wipe and write).",
        inputSchema: {
            type: "object",
            properties: {
                data: { type: "object", description: "The export JSON object (from export_memories)." },
                mode: { type: "string", enum: ["merge", "replace"], description: "Import mode (default: merge)." },
            },
            required: ["data"],
        },
    },
    {
        name: "link_memories",
        description: "Create a bidirectional link between two related memories (lightweight knowledge graph).",
        inputSchema: {
            type: "object",
            properties: {
                id1: { type: "string", description: "First memory ID." },
                id2: { type: "string", description: "Second memory ID." },
            },
            required: ["id1", "id2"],
        },
    },
    {
        name: "cleanup_expired",
        description: "Delete all memories that have passed their TTL expiry time.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "semantic_search",
        description: "Search memories by meaning using AI embeddings. Requires GEMINI_API_KEY. Returns results ranked by semantic similarity.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Natural language query to search by meaning." },
                limit: { type: "number", description: "Max results (1-50, default: 10)." },
            },
            required: ["query"],
        },
    },
];

// ── Server Class ────────────────────────────────────────────────────

export class MemoryServer {
    private server: Server;
    private store: FirestoreMemoryStore;
    private embeddings: EmbeddingService | null;

    constructor(store: FirestoreMemoryStore, embeddings: EmbeddingService | null = null) {
        this.store = store;
        this.embeddings = embeddings;
        this.server = new Server(
            { name: "firebase-shared-memory-server", version: SERVER_VERSION },
            { capabilities: { tools: {} } }
        );

        this.registerTools();

        this.server.onerror = (error) => logger.error("MCP protocol error", error);

        const shutdown = async () => {
            logger.info("Shutting down...");
            await this.server.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    }

    private registerTools() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: TOOL_DEFINITIONS,
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: rawArgs } = request.params;
            const args = (rawArgs ?? {}) as Record<string, unknown>;

            try {
                switch (name) {
                    case "add_memory":
                        return this.handleAddMemory(args);
                    case "get_memory":
                        return this.handleGetMemory(args);
                    case "get_all_memories":
                        return this.handleGetAllMemories(args);
                    case "search_memories":
                        return this.handleSearchMemories(args);
                    case "update_memory":
                        return this.handleUpdateMemory(args);
                    case "delete_memory":
                        return this.handleDeleteMemory(args);
                    case "memory_stats":
                        return this.handleMemoryStats();
                    case "pin_memory":
                        return this.handlePinMemory(args);
                    case "add_memories":
                        return this.handleAddMemories(args);
                    case "delete_memories":
                        return this.handleDeleteMemories(args);
                    case "export_memories":
                        return this.handleExportMemories();
                    case "import_memories":
                        return this.handleImportMemories(args);
                    case "link_memories":
                        return this.handleLinkMemories(args);
                    case "cleanup_expired":
                        return this.handleCleanupExpired();
                    case "semantic_search":
                        return this.handleSemanticSearch(args);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            } catch (error: any) {
                if (error instanceof McpError) throw error;
                logger.error(`${name} failed`, error);
                throw new McpError(ErrorCode.InternalError, `${name} failed: ${error.message}`);
            }
        });
    }

    // ── Tool Handlers ───────────────────────────────────────────────

    private async handleAddMemory(args: Record<string, unknown>) {
        const fact = requireString(args, "fact");
        if (fact.length > MAX_FACT_LENGTH) {
            throw new McpError(ErrorCode.InvalidParams, `Fact exceeds ${MAX_FACT_LENGTH} characters.`);
        }
        const tags = optionalStringArray(args, "tags");
        const pinned = optionalBool(args, "pinned");
        const ttl_hours = optionalInt(args, "ttl_hours");

        const id = await this.store.add({ fact, tags, pinned, ttl_hours });
        const parts = [`Memory added successfully. ID: ${id}`];
        if (pinned) parts.push("📌 Pinned");
        if (ttl_hours) parts.push(`⏰ Expires in ${ttl_hours}h`);
        return textResponse(parts.join(" | "));
    }

    private async handleGetMemory(args: Record<string, unknown>) {
        const id = requireString(args, "id");
        const memory = await this.store.getById(id);
        if (!memory) return textResponse(`Memory with ID ${id} not found.`);

        // Fetch related memories inline
        const related = await this.store.getRelated(id);
        const result: any = { ...memory };
        if (related.length > 0) {
            result.related = related.map((r) => ({ id: r.id, fact: r.fact, tags: r.tags }));
        }
        return textResponse(JSON.stringify(result, null, 2));
    }

    private async handleGetAllMemories(args: Record<string, unknown>) {
        const limit = optionalInt(args, "limit");
        const offset = optionalInt(args, "offset");
        const memories = await this.store.getAll({ limit, offset });
        return textResponse(
            memories.length > 0 ? JSON.stringify(memories, null, 2) : "No memories found."
        );
    }

    private async handleSearchMemories(args: Record<string, unknown>) {
        const query = optionalString(args, "query");
        const tags = optionalStringArray(args, "tags");

        if (!query && (!tags || tags.length === 0)) {
            throw new McpError(ErrorCode.InvalidParams, "Provide at least one of 'query' or 'tags'.");
        }

        let results;

        if (tags && tags.length > 0 && query) {
            // Both: smart search then filter by tags
            const smartResults = await this.store.smartSearch(query);
            results = smartResults.filter((m) =>
                tags.some((t) => m.tags.includes(t.toLowerCase()))
            );
        } else if (tags && tags.length > 0) {
            const tagResults = await this.store.searchByTags(tags);
            results = tagResults.map((m) => ({ ...m, relevance: 1.0 }));
        } else {
            results = await this.store.smartSearch(query!);
        }

        return textResponse(
            results.length > 0
                ? JSON.stringify(results, null, 2)
                : "No matching memories found."
        );
    }

    private async handleUpdateMemory(args: Record<string, unknown>) {
        const id = requireString(args, "id");
        const fact = optionalString(args, "fact");
        const tags = optionalStringArray(args, "tags");
        const pinned = optionalBool(args, "pinned");

        if (fact === undefined && tags === undefined && pinned === undefined) {
            throw new McpError(ErrorCode.InvalidParams, "Provide at least one of 'fact', 'tags', or 'pinned'.");
        }
        if (fact !== undefined && fact.length > MAX_FACT_LENGTH) {
            throw new McpError(ErrorCode.InvalidParams, `Fact exceeds ${MAX_FACT_LENGTH} characters.`);
        }

        try {
            const updated = await this.store.update(id, { fact, tags, pinned });
            return textResponse(`Memory updated.\n${JSON.stringify(updated, null, 2)}`);
        } catch (error: any) {
            if (error.message?.includes("not found")) {
                return textResponse(`Memory with ID ${id} not found.`);
            }
            throw error;
        }
    }

    private async handleDeleteMemory(args: Record<string, unknown>) {
        const id = requireString(args, "id");
        const deleted = await this.store.delete(id);
        return textResponse(
            deleted ? `Deleted memory: ${id}` : `Memory with ID ${id} not found.`
        );
    }

    private async handleMemoryStats() {
        const stats = await this.store.getStats();
        return textResponse(JSON.stringify(stats, null, 2));
    }

    private async handlePinMemory(args: Record<string, unknown>) {
        const id = requireString(args, "id");
        try {
            const memory = await this.store.togglePin(id);
            return textResponse(
                `${memory.pinned ? "📌 Pinned" : "📌 Unpinned"} memory: ${id}\n${JSON.stringify(memory, null, 2)}`
            );
        } catch (error: any) {
            if (error.message?.includes("not found")) {
                return textResponse(`Memory with ID ${id} not found.`);
            }
            throw error;
        }
    }

    private async handleAddMemories(args: Record<string, unknown>) {
        const memories = args?.memories;
        if (!Array.isArray(memories) || memories.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, "'memories' must be a non-empty array.");
        }

        const inputs: AddMemoryInput[] = memories.slice(0, 20).map((m: any, i: number) => {
            if (typeof m?.fact !== "string" || m.fact.trim().length === 0) {
                throw new McpError(ErrorCode.InvalidParams, `Memory at index ${i} must have a non-empty 'fact'.`);
            }
            return {
                fact: m.fact.trim(),
                tags: Array.isArray(m.tags) ? m.tags.map((t: string) => t.toLowerCase()) : undefined,
                pinned: m.pinned === true ? true : undefined,
                ttl_hours: typeof m.ttl_hours === "number" ? m.ttl_hours : undefined,
            };
        });

        const result = await this.store.addBulk(inputs);
        return textResponse(
            `Bulk add: ${result.succeeded} succeeded, ${result.failed} failed.\nIDs: ${result.ids.join(", ")}` +
            (result.errors.length > 0 ? `\nErrors: ${result.errors.join("; ")}` : "")
        );
    }

    private async handleDeleteMemories(args: Record<string, unknown>) {
        const ids = requireStringArray(args, "ids");
        const result = await this.store.deleteBulk(ids.slice(0, 20));
        return textResponse(
            `Bulk delete: ${result.succeeded} deleted, ${result.failed} not found.` +
            (result.errors.length > 0 ? `\nNot found: ${result.errors.join("; ")}` : "")
        );
    }

    private async handleExportMemories() {
        const exportData = await this.store.exportAll();
        return textResponse(JSON.stringify(exportData, null, 2));
    }

    private async handleImportMemories(args: Record<string, unknown>) {
        const data = args?.data as ExportData | undefined;
        if (!data || !Array.isArray(data.memories)) {
            throw new McpError(ErrorCode.InvalidParams, "'data' must be a valid export object with a 'memories' array.");
        }

        const mode = (args?.mode as string) === "replace" ? "replace" : "merge";
        const result = await this.store.importAll(data, mode);
        return textResponse(
            `Import (${mode}): ${result.succeeded} imported, ${result.failed} skipped.\n` +
            (result.errors.length > 0 ? `Skipped: ${result.errors.join("; ")}` : "")
        );
    }

    private async handleLinkMemories(args: Record<string, unknown>) {
        const id1 = requireString(args, "id1");
        const id2 = requireString(args, "id2");

        if (id1 === id2) {
            throw new McpError(ErrorCode.InvalidParams, "Cannot link a memory to itself.");
        }

        try {
            await this.store.link(id1, id2);
            return textResponse(`🔗 Linked: ${id1} ↔ ${id2}`);
        } catch (error: any) {
            if (error.message?.includes("not found")) {
                return textResponse(error.message);
            }
            throw error;
        }
    }

    private async handleCleanupExpired() {
        const count = await this.store.cleanupExpired();
        return textResponse(
            count > 0
                ? `🧹 Cleaned up ${count} expired memories.`
                : "No expired memories to clean up."
        );
    }

    private async handleSemanticSearch(args: Record<string, unknown>) {
        const query = requireString(args, "query");
        const limit = Math.min(Math.max(optionalInt(args, "limit") ?? 10, 1), 50);

        if (!this.embeddings) {
            // Fallback to smart search if no embedding service
            const results = await this.store.smartSearch(query);
            return textResponse(
                results.length > 0
                    ? `⚠️ Semantic search unavailable (no GEMINI_API_KEY). Using smart search fallback.\n\n${JSON.stringify(results.slice(0, limit), null, 2)}`
                    : "No matching memories found (using smart search fallback — set GEMINI_API_KEY for semantic search)."
            );
        }

        // Generate query embedding
        const queryVector = await this.embeddings.embed(query);
        if (queryVector.length === 0) {
            throw new McpError(ErrorCode.InternalError, "Failed to generate query embedding.");
        }

        const results = await this.store.semanticSearch(queryVector, limit);
        return textResponse(
            results.length > 0
                ? `🧠 Semantic search results:\n\n${JSON.stringify(results, null, 2)}`
                : "No semantically similar memories found."
        );
    }

    /** Start the server on the stdio transport. */
    async run(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.info("Firebase Shared Memory MCP server running on stdio");
    }
}
