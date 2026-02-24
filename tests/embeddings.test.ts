/**
 * Deep edge-case tests for the multi-provider embedding service.
 *
 * Covers: provider auto-detection, fallback behavior, API errors,
 * empty inputs, batch edge cases, dimension validation.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// ── Mock logger ─────────────────────────────────────────
const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.unstable_mockModule("../src/logger.js", () => ({
    logger: mockLogger,
}));

// Now we can safely import the modules under test dynamically
const { createEmbeddingService, EmbeddingService, __geminiDeps } = await import("../src/embeddings.js");

// ── Mock Gemini API ──────────────────────────────────────
const mockEmbedContent = jest.fn<any>();
__geminiDeps.createClient = () => ({
    models: { embedContent: mockEmbedContent },
});

// ── Mock fetch for OpenAI/Cohere ────────────────────────
const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

describe("Multi-Provider Embedding Service", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ═════════════════════════════════════════════════════════
    // PROVIDER AUTO-DETECTION
    // ═════════════════════════════════════════════════════════

    describe("Provider Auto-Detection", () => {
        it("should return null when no API keys are configured", () => {
            const service = createEmbeddingService({});
            expect(service).toBeNull();
        });

        it("should return null when all keys are empty strings", () => {
            const service = createEmbeddingService({
                geminiApiKey: "",
                openaiApiKey: "",
                cohereApiKey: "",
            });
            expect(service).toBeNull();
        });

        it("should return null when all keys are undefined", () => {
            const service = createEmbeddingService({
                geminiApiKey: undefined,
                openaiApiKey: undefined,
                cohereApiKey: undefined,
            });
            expect(service).toBeNull();
        });

        it("should auto-detect Gemini when only GEMINI_API_KEY is set", () => {
            const service = createEmbeddingService({ geminiApiKey: "gm-test-key" });
            expect(service).not.toBeNull();
            expect(service!.providerName).toContain("Gemini");
        });

        it("should auto-detect OpenAI when only OPENAI_API_KEY is set", () => {
            const service = createEmbeddingService({ openaiApiKey: "sk-test-key" });
            expect(service).not.toBeNull();
            expect(service!.providerName).toContain("OpenAI");
        });

        it("should auto-detect Cohere when only COHERE_API_KEY is set", () => {
            const service = createEmbeddingService({ cohereApiKey: "co-test-key" });
            expect(service).not.toBeNull();
            expect(service!.providerName).toContain("Cohere");
        });

        it("should prefer Gemini over OpenAI when both keys are set", () => {
            const service = createEmbeddingService({
                geminiApiKey: "gm-key",
                openaiApiKey: "sk-key",
            });
            expect(service!.providerName).toContain("Gemini");
        });

        it("should prefer OpenAI over Cohere when both keys are set (no Gemini)", () => {
            const service = createEmbeddingService({
                openaiApiKey: "sk-key",
                cohereApiKey: "co-key",
            });
            expect(service!.providerName).toContain("OpenAI");
        });

        it("should override auto-detection with explicit EMBEDDING_PROVIDER=openai", () => {
            const service = createEmbeddingService({
                geminiApiKey: "gm-key",
                openaiApiKey: "sk-key",
                embeddingProvider: "openai",
            });
            expect(service!.providerName).toContain("OpenAI");
        });

        it("should override auto-detection with explicit EMBEDDING_PROVIDER=cohere", () => {
            const service = createEmbeddingService({
                geminiApiKey: "gm-key",
                cohereApiKey: "co-key",
                embeddingProvider: "cohere",
            });
            expect(service!.providerName).toContain("Cohere");
        });

        it("should handle EMBEDDING_PROVIDER with wrong case (case-insensitive)", () => {
            const service = createEmbeddingService({
                openaiApiKey: "sk-key",
                embeddingProvider: "OpenAI",
            });
            expect(service!.providerName).toContain("OpenAI");
        });

        it("should fall through to auto-detect if explicit provider has no key", () => {
            const service = createEmbeddingService({
                geminiApiKey: "gm-key",
                embeddingProvider: "openai", // no openaiApiKey
            });
            // Falls through explicit, then auto-detects Gemini
            expect(service!.providerName).toContain("Gemini");
        });
    });

    // ═════════════════════════════════════════════════════════
    // GEMINI PROVIDER
    // ═════════════════════════════════════════════════════════

    describe("Gemini Provider", () => {
        it("should return 768-dimensional embeddings", async () => {
            const fakeEmbedding = new Array(768).fill(0.1);
            mockEmbedContent.mockResolvedValue({
                embeddings: [{ values: fakeEmbedding }],
            });

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            const result = await service!.embed("test text");

            expect(result).toHaveLength(768);
            expect(service!.dimensions).toBe(768);
        });

        it("should return empty array when API returns no embeddings", async () => {
            mockEmbedContent.mockResolvedValue({ embeddings: [{ values: [] }] });

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            const result = await service!.embed("empty response");

            expect(result).toHaveLength(0);
        });

        it("should return empty array when embeddings field is undefined", async () => {
            mockEmbedContent.mockResolvedValue({ embeddings: undefined });

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            const result = await service!.embed("undefined response");

            expect(result).toHaveLength(0);
        });

        it("should return empty array when Gemini API returns undefined values", async () => {
            mockEmbedContent.mockResolvedValue({
                embeddings: [{ values: undefined }],
            });

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            const result = await service!.embed("test");

            expect(result).toHaveLength(0);
        });

        it("should throw when Gemini API returns error", async () => {
            mockEmbedContent.mockRejectedValue(new Error("Quota exceeded"));

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            await expect(service!.embed("fail")).rejects.toThrow("Quota exceeded");
        });

        it("should handle batch embedding sequentially", async () => {
            const embedding = new Array(768).fill(0.5);
            mockEmbedContent.mockResolvedValue({
                embeddings: [{ values: embedding }],
            });

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });
            const result = await service!.embedBatch(["text1", "text2", "text3"]);

            expect(result).toHaveLength(3);
            expect(mockEmbedContent).toHaveBeenCalledTimes(3);
        });
    });

    // ═════════════════════════════════════════════════════════
    // OPENAI PROVIDER
    // ═════════════════════════════════════════════════════════

    describe("OpenAI Provider", () => {
        it("should default to text-embedding-3-small (1536d)", () => {
            const service = createEmbeddingService({ openaiApiKey: "sk-test" });
            expect(service!.dimensions).toBe(1536);
        });

        it("should detect text-embedding-3-large dimensions (3072d)", () => {
            const service = createEmbeddingService({
                openaiApiKey: "sk-test",
                openaiModel: "text-embedding-3-large",
            });
            expect(service!.dimensions).toBe(3072);
        });

        it("should call the correct endpoint for single embed", async () => {
            const embedding = new Array(1536).fill(0.1);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ embedding, index: 0 }] }),
            } as Response);

            const service = createEmbeddingService({ openaiApiKey: "sk-test" });
            const result = await service!.embed("hello");

            expect(result).toHaveLength(1536);
            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.openai.com/v1/embeddings",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        Authorization: "Bearer sk-test",
                    }),
                })
            );
        });

        it("should use custom base URL for compatible APIs (Azure, Ollama)", async () => {
            const embedding = new Array(1536).fill(0.1);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ embedding, index: 0 }] }),
            } as Response);

            const service = createEmbeddingService({
                openaiApiKey: "key",
                openaiBaseUrl: "http://localhost:11434/v1/",
            });
            await service!.embed("test");

            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost:11434/v1/embeddings",
                expect.any(Object)
            );
        });

        it("should strip trailing slash from base URL", async () => {
            const embedding = new Array(1536).fill(0.1);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ embedding, index: 0 }] }),
            } as Response);

            const service = createEmbeddingService({
                openaiApiKey: "key",
                openaiBaseUrl: "https://custom.api.com/v1/",
            });
            await service!.embed("test");

            // Should not double-slash
            expect(mockFetch).toHaveBeenCalledWith(
                "https://custom.api.com/v1/embeddings",
                expect.any(Object)
            );
        });

        it("should throw on non-OK HTTP response", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 429,
                text: () => Promise.resolve("Rate limit exceeded"),
            } as Response);

            const service = createEmbeddingService({ openaiApiKey: "sk-test" });
            await expect(service!.embed("throttled")).rejects.toThrow("429");
        });

        it("should sort batch responses by index", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        data: [
                            { embedding: [0.3], index: 2 },
                            { embedding: [0.1], index: 0 },
                            { embedding: [0.2], index: 1 },
                        ],
                    }),
            } as Response);

            const service = createEmbeddingService({ openaiApiKey: "sk-test" });
            const result = await service!.embedBatch(["a", "b", "c"]);

            expect(result[0]).toEqual([0.1]); // index 0
            expect(result[1]).toEqual([0.2]); // index 1
            expect(result[2]).toEqual([0.3]); // index 2
        });

        it("should throw on batch non-OK response", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve("Internal server error"),
            } as Response);

            const service = createEmbeddingService({ openaiApiKey: "sk-test" });
            await expect(service!.embedBatch(["a"])).rejects.toThrow("500");
        });
    });

    // ═════════════════════════════════════════════════════════
    // COHERE PROVIDER
    // ═════════════════════════════════════════════════════════

    describe("Cohere Provider", () => {
        it("should default to embed-english-v3.0 (1024d)", () => {
            const service = createEmbeddingService({ cohereApiKey: "co-test" });
            expect(service!.dimensions).toBe(1024);
        });

        it("should embed single text via batch endpoint", async () => {
            const embedding = new Array(1024).fill(0.1);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        embeddings: { float: [embedding] },
                    }),
            } as Response);

            const service = createEmbeddingService({ cohereApiKey: "co-test" });
            const result = await service!.embed("single text");

            expect(result).toHaveLength(1024);
            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.cohere.com/v2/embed",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        Authorization: "Bearer co-test",
                    }),
                })
            );
        });

        it("should handle batch embeddings", async () => {
            const e1 = new Array(1024).fill(0.1);
            const e2 = new Array(1024).fill(0.2);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({ embeddings: { float: [e1, e2] } }),
            } as Response);

            const service = createEmbeddingService({ cohereApiKey: "co-test" });
            const result = await service!.embedBatch(["a", "b"]);

            expect(result).toHaveLength(2);
        });

        it("should throw on Cohere API error", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                text: () => Promise.resolve("Invalid API key"),
            } as Response);

            const service = createEmbeddingService({ cohereApiKey: "bad-key" });
            await expect(service!.embed("fail")).rejects.toThrow("401");
        });

        it("should use custom model name", () => {
            const service = createEmbeddingService({
                cohereApiKey: "co-test",
                cohereModel: "embed-multilingual-v3.0",
            });
            expect(service!.providerName).toContain("embed-multilingual-v3.0");
        });
    });

    // ═════════════════════════════════════════════════════════
    // EMBEDDING SERVICE WRAPPER
    // ═════════════════════════════════════════════════════════

    describe("EmbeddingService Error Handling", () => {
        it("should log provider name on embed failure", async () => {
            mockEmbedContent.mockRejectedValue(new Error("Network error"));

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });

            try { await service!.embed("fail"); } catch { }

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Embedding generation failed",
                expect.objectContaining({ provider: expect.stringContaining("Gemini") })
            );
        });

        it("should log provider name on batch failure", async () => {
            mockEmbedContent.mockRejectedValue(new Error("Timeout"));

            const service = createEmbeddingService({ geminiApiKey: "gm-test" });

            try { await service!.embedBatch(["fail"]); } catch { }

            expect(mockLogger.error).toHaveBeenCalledWith(
                "Batch embedding failed",
                expect.objectContaining({ provider: expect.stringContaining("Gemini") })
            );
        });
    });

    // ═════════════════════════════════════════════════════════
    // OPENAI-COMPATIBLE (3rd Party)
    // ═════════════════════════════════════════════════════════

    describe("OpenAI-Compatible APIs", () => {
        it("should support Ollama (localhost:11434)", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({ data: [{ embedding: [0.1, 0.2], index: 0 }] }),
            } as Response);

            const service = createEmbeddingService({
                openaiApiKey: "ollama",
                openaiBaseUrl: "http://localhost:11434/v1",
                openaiModel: "nomic-embed-text",
                embeddingProvider: "openai-compatible",
            });

            expect(service!.providerName).toContain("nomic-embed-text");
            const result = await service!.embed("local test");
            expect(result).toEqual([0.1, 0.2]);
        });

        it("should support LM Studio (localhost:1234)", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({ data: [{ embedding: [0.5], index: 0 }] }),
            } as Response);

            const service = createEmbeddingService({
                openaiApiKey: "lm-studio",
                openaiBaseUrl: "http://localhost:1234/v1",
                openaiModel: "local-embed-model",
                embeddingProvider: "openai-compatible",
            });

            await service!.embed("local");
            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost:1234/v1/embeddings",
                expect.any(Object)
            );
        });
    });
});
