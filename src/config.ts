/**
 * Centralized configuration loader.
 *
 * Resolves config from CLI args and environment variables (dotenv supported).
 * Exits with a clear message if required values are missing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { logger } from "./logger.js";
import type { ServerConfig } from "./types.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parse and validate all server configuration.
 * Exits the process with code 1 if required values are absent.
 */
export function loadConfig(): ServerConfig {
    // --- Service Account ---
    const serviceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");

    if (!fs.existsSync(serviceAccountPath)) {
        logger.error(
            "Missing serviceAccountKey.json. Place your Firebase Admin SDK JSON key file at the project root."
        );
        process.exit(1);
    }

    // --- User ID ---
    const args = process.argv.slice(2);
    const userId =
        args.find((arg) => arg.startsWith("--user-id="))?.split("=")[1] ||
        process.env.USER_ID;

    if (!userId) {
        logger.error(
            "Missing user identifier. Provide '--user-id=<id>' argument or set the USER_ID environment variable."
        );
        process.exit(1);
    }

    // --- Embedding Config (optional — any one provider enables semantic search) ---
    const geminiApiKey =
        args.find((arg) => arg.startsWith("--gemini-key="))?.split("=")[1] ||
        process.env.GEMINI_API_KEY;

    const openaiApiKey =
        args.find((arg) => arg.startsWith("--openai-key="))?.split("=")[1] ||
        process.env.OPENAI_API_KEY;

    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    const openaiModel = process.env.OPENAI_MODEL;

    const cohereApiKey =
        args.find((arg) => arg.startsWith("--cohere-key="))?.split("=")[1] ||
        process.env.COHERE_API_KEY;

    const cohereModel = process.env.COHERE_MODEL;

    const embeddingProvider =
        args.find((arg) => arg.startsWith("--embedding-provider="))?.split("=")[1] ||
        process.env.EMBEDDING_PROVIDER;

    logger.info(`Configuration loaded for user: ${userId}`);

    return {
        userId,
        serviceAccountPath,
        geminiApiKey,
        openaiApiKey,
        openaiBaseUrl,
        openaiModel,
        cohereApiKey,
        cohereModel,
        embeddingProvider,
    };
}
