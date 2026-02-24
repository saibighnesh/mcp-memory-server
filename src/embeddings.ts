/**
 * Multi-provider embedding service.
 *
 * Supports: Gemini (free), OpenAI, Cohere, and any OpenAI-compatible API.
 * Auto-detects provider from environment variables.
 * Returns null gracefully when no API key is configured.
 */

import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger.js";

// ─── For Safe ESM Testing ────────────────────────────────

export const __geminiDeps = {
    createClient: (apiKey: string): any => new GoogleGenAI({ apiKey })
};

// ─── Provider Interface ──────────────────────────────────

export interface EmbeddingProvider {
    name: string;
    dimensions: number;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── Gemini Provider ─────────────────────────────────────

class GeminiProvider implements EmbeddingProvider {
    name = "Gemini (text-embedding-004)";
    dimensions = 768;
    private client: any;

    constructor(apiKey: string) {
        this.client = __geminiDeps.createClient(apiKey);
    }

    async embed(text: string): Promise<number[]> {
        const response = await this.client.models.embedContent({
            model: "text-embedding-004",
            contents: text,
        });
        const values = response.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
            logger.warn("Empty embedding returned from Gemini API");
            return [];
        }
        return values;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map((text) => this.embed(text)));
    }
}

// ─── OpenAI Provider ─────────────────────────────────────

class OpenAIProvider implements EmbeddingProvider {
    name: string;
    dimensions = 1536;
    private apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(apiKey: string, baseUrl?: string, model?: string) {
        this.apiKey = apiKey;
        this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
        this.model = model || "text-embedding-3-small";
        this.name = `OpenAI (${this.model})`;

        // text-embedding-3-small = 1536, text-embedding-3-large = 3072, ada-002 = 1536
        if (this.model.includes("3-large")) this.dimensions = 3072;
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: text }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI embeddings failed (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: texts }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI batch embeddings failed (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.data
            .sort((a: any, b: any) => a.index - b.index)
            .map((d: any) => d.embedding);
    }
}

// ─── Cohere Provider ─────────────────────────────────────

class CohereProvider implements EmbeddingProvider {
    name = "Cohere (embed-english-v3.0)";
    dimensions = 1024;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || "embed-english-v3.0";
        this.name = `Cohere (${this.model})`;
    }

    async embed(text: string): Promise<number[]> {
        const result = await this.embedBatch([text]);
        return result[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch("https://api.cohere.com/v2/embed", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                texts,
                input_type: "search_document",
                embedding_types: ["float"],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Cohere embeddings failed (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        return data.embeddings.float;
    }
}

// ─── Unified Embedding Service ───────────────────────────

export class EmbeddingService {
    private provider: EmbeddingProvider;

    constructor(provider: EmbeddingProvider) {
        this.provider = provider;
        logger.info(`Embedding service initialized: ${provider.name} (${provider.dimensions}d)`);
    }

    get providerName(): string {
        return this.provider.name;
    }

    get dimensions(): number {
        return this.provider.dimensions;
    }

    async embed(text: string): Promise<number[]> {
        try {
            return await this.provider.embed(text);
        } catch (error: any) {
            logger.error("Embedding generation failed", { provider: this.provider.name, message: error.message });
            throw error;
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        try {
            return await this.provider.embedBatch(texts);
        } catch (error: any) {
            logger.error("Batch embedding failed", { provider: this.provider.name, message: error.message });
            throw error;
        }
    }
}

// ─── Auto-detect Provider ────────────────────────────────

export interface EmbeddingConfig {
    geminiApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    openaiModel?: string;
    cohereApiKey?: string;
    cohereModel?: string;
    embeddingProvider?: string; // "gemini" | "openai" | "cohere" | "openai-compatible"
}

/**
 * Create an EmbeddingService from config, auto-detecting the provider.
 *
 * Priority: explicit EMBEDDING_PROVIDER → first available key.
 * Returns null if no keys are configured (semantic search disabled).
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService | null {
    const explicit = config.embeddingProvider?.toLowerCase();

    // Explicit provider selection
    if (explicit === "gemini" && config.geminiApiKey) {
        return new EmbeddingService(new GeminiProvider(config.geminiApiKey));
    }
    if ((explicit === "openai" || explicit === "openai-compatible") && config.openaiApiKey) {
        return new EmbeddingService(new OpenAIProvider(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel));
    }
    if (explicit === "cohere" && config.cohereApiKey) {
        return new EmbeddingService(new CohereProvider(config.cohereApiKey, config.cohereModel));
    }

    // Auto-detect from available keys (priority: Gemini → OpenAI → Cohere)
    if (config.geminiApiKey) {
        return new EmbeddingService(new GeminiProvider(config.geminiApiKey));
    }
    if (config.openaiApiKey) {
        return new EmbeddingService(new OpenAIProvider(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel));
    }
    if (config.cohereApiKey) {
        return new EmbeddingService(new CohereProvider(config.cohereApiKey, config.cohereModel));
    }

    logger.info("No embedding API key set — semantic search disabled (using smart search fallback)");
    return null;
}
