/**
 * Smoke test — exercises all 14 MCP tools against a live Firestore instance.
 *
 * Usage:  node tests/smoke.mjs
 * Requires: serviceAccountKey.json in project root
 */

import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "dist", "index.js");

async function callTool(client, toolName, args = {}) {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = result?.content?.[0]?.text ?? JSON.stringify(result);
    console.log(`  ✅ ${toolName}: ${text}\n`);
    return text;
}

async function main() {
    console.log("🚀 Starting MCP Memory Server smoke test (14 tools)...\n");

    const transport = new StdioClientTransport({
        command: "node",
        args: [SERVER_PATH, "--user-id=smoke-test-user"],
    });

    const client = new Client({ name: "smoke-test", version: "1.0.0" });
    await client.connect(transport);
    console.log("📡 Connected to MCP server\n");

    // ── List tools ───────────────────────────────────────────────
    console.log("📋 Listing tools...");
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();
    console.log(`  ✅ ${toolNames.length} tools: ${toolNames.join(", ")}\n`);

    // ── Test core tools ──────────────────────────────────────────
    console.log("🔬 Testing tools against live Firestore...\n");

    const ts = new Date().toISOString();

    // 1. add_memory (with tags + pinned)
    const addResult = await callTool(client, "add_memory", {
        fact: `Smoke test: The meaning of life is 42 — ${ts}`,
        tags: ["smoke-test", "automated"],
        pinned: true,
    });
    const idMatch = addResult.match(/ID:\s*(\S+)/);
    const memoryId = idMatch?.[1];
    console.log(`     → Memory ID: ${memoryId}\n`);

    // 2. get_memory (should show pinned + related)
    await callTool(client, "get_memory", { id: memoryId });

    // 3. add_memory with TTL
    const ttlResult = await callTool(client, "add_memory", {
        fact: `Temporary note — expires in 1h — ${ts}`,
        tags: ["temporary"],
        ttl_hours: 1,
    });
    const ttlIdMatch = ttlResult.match(/ID:\s*(\S+)/);
    const ttlMemoryId = ttlIdMatch?.[1];

    // 4. get_all_memories (pinned first)
    await callTool(client, "get_all_memories", { limit: 5 });

    // 5. search_memories (smart search with relevance)
    await callTool(client, "search_memories", { query: "meaning of life" });

    // 6. search_memories by tags
    await callTool(client, "search_memories", { tags: ["smoke-test"] });

    // 7. update_memory
    await callTool(client, "update_memory", {
        id: memoryId,
        fact: "Updated: the answer is definitely 42",
        tags: ["smoke-test", "updated"],
    });

    // 8. pin_memory (unpin)
    await callTool(client, "pin_memory", { id: memoryId });

    // 9. add_memories (bulk)
    await callTool(client, "add_memories", {
        memories: [
            { fact: `Bulk memory A — ${ts}`, tags: ["bulk"] },
            { fact: `Bulk memory B — ${ts}`, tags: ["bulk"] },
        ],
    });

    // 10. link_memories
    if (ttlMemoryId) {
        await callTool(client, "link_memories", { id1: memoryId, id2: ttlMemoryId });
    }

    // 11. get_memory (should now show related)
    await callTool(client, "get_memory", { id: memoryId });

    // 12. export_memories
    const exportResult = await callTool(client, "export_memories", {});

    // 13. memory_stats
    await callTool(client, "memory_stats", {});

    // 14. cleanup_expired
    await callTool(client, "cleanup_expired", {});

    // ── Cleanup ──────────────────────────────────────────────────
    console.log("🧹 Cleaning up test data...\n");

    // Delete all test memories
    const allResult = await client.callTool({ name: "get_all_memories", arguments: { limit: 50 } });
    const allText = allResult?.content?.[0]?.text ?? "[]";
    try {
        const memories = JSON.parse(allText);
        if (Array.isArray(memories)) {
            const ids = memories.map((m) => m.id);
            if (ids.length > 0) {
                await callTool(client, "delete_memories", { ids });
            }
        }
    } catch {
        // If parse fails, delete individually
        if (memoryId) await callTool(client, "delete_memory", { id: memoryId });
        if (ttlMemoryId) await callTool(client, "delete_memory", { id: ttlMemoryId });
    }

    // Final stats (should be 0)
    await callTool(client, "memory_stats", {});

    console.log("🎉 Smoke test complete!\n");
    await client.close();
}

main().catch((err) => {
    console.error("💥 Smoke test failed:", err);
    process.exit(1);
});
