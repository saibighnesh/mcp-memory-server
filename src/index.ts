#!/usr/bin/env node

/**
 * OmniBrain MCP — entrypoint.
 *
 * Loads configuration, initializes the Firestore store,
 * optionally sets up the embedding service for semantic search,
 * creates the MCP server, and starts listening on stdio.
 */

import { loadConfig } from "./config.js";
import { initFirestore } from "./store.js";
import { createEmbeddingService } from "./embeddings.js";
import { MemoryServer } from "./server.js";
import { logger } from "./logger.js";

const config = loadConfig();
const embeddings = createEmbeddingService(config);
const store = initFirestore(config, embeddings);
const server = new MemoryServer(store, embeddings);

server.run().catch((error) => {
  logger.error("Fatal error starting server", error);
  process.exit(1);
});
