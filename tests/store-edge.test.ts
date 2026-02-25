/**
 * Deep edge-case tests for FirestoreMemoryStore — Phase 2 features.
 *
 * Covers: bulk operations, link/unlink, getRelated, export/import,
 * cleanupExpired, tag normalization, pagination bounds, retry logic,
 * concurrent-safe edge cases, and data integrity guards.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mock Helpers ─────────────────────────────────────────────

function createMockDoc(id: string, data: Record<string, any>, exists = true) {
    return {
        id,
        exists,
        data: () => (exists ? data : undefined),
        ref: { id },
    };
}

function createMockTimestamp(isoString: string) {
    return { toDate: () => new Date(isoString) };
}

function createMockSnapshot(docs: ReturnType<typeof createMockDoc>[]) {
    return { docs, size: docs.length, empty: docs.length === 0 };
}

// ── Mocks ────────────────────────────────────────────────────

jest.mock("firebase-admin/app", () => ({
    getApps: jest.fn(() => [{ name: "mock" }]),
    initializeApp: jest.fn(),
    cert: jest.fn(),
}));

jest.mock("firebase-admin/firestore", () => ({
    getFirestore: jest.fn(),
    FieldValue: {
        serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
        arrayUnion: jest.fn((...vals: any[]) => ({ _arrayUnion: vals })),
        arrayRemove: jest.fn((...vals: any[]) => ({ _arrayRemove: vals })),
        vector: jest.fn((v: number[]) => ({ _vector: v })),
    },
    Timestamp: {
        fromDate: jest.fn((d: Date) => ({ toDate: () => d })),
        now: jest.fn(() => ({ toDate: () => new Date() })),
    },
}));

jest.mock("../src/logger.js", () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

// ── Import after mocks ──────────────────────────────────────

import { FirestoreMemoryStore } from "../src/store.js";

// ── Test Suite ───────────────────────────────────────────────

describe("FirestoreMemoryStore — Edge Cases", () => {
    let store: FirestoreMemoryStore;
    let mockCollection: any;
    let mockDb: any;
    let mockBatch: any;

    function createChainableMock(result: any) {
        const chain: any = {
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            count: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(result),
            add: jest.fn().mockResolvedValue({ id: "new-doc-id" }),
            doc: jest.fn(),
        };
        return chain;
    }

    beforeEach(() => {
        jest.clearAllMocks();

        mockCollection = createChainableMock(createMockSnapshot([]));

        mockBatch = {
            set: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
            commit: jest.fn().mockResolvedValue(undefined),
        };

        mockDb = {
            collection: jest.fn().mockReturnValue({
                doc: jest.fn().mockReturnValue({
                    collection: jest.fn().mockReturnValue(mockCollection),
                }),
            }),
            batch: jest.fn().mockReturnValue(mockBatch),
            getAll: jest.fn().mockResolvedValue([]),
        };

        store = new FirestoreMemoryStore(mockDb as any, "test-user");
    });

    // ═════════════════════════════════════════════════════════
    // TAG NORMALIZATION
    // ═════════════════════════════════════════════════════════

    describe("Tag Normalization", () => {
        it("should lowercase all tags on add", async () => {
            mockCollection.add.mockResolvedValue({ id: "t1" });

            await store.add({ fact: "Test", tags: ["JavaScript", "REACT", "TypeScript"] });

            expect(mockCollection.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    tags: ["javascript", "react", "typescript"],
                })
            );
        });

        it("should lowercase tags on update", async () => {
            const mockDocRef = {
                get: jest.fn()
                    .mockResolvedValueOnce(createMockDoc("u1", { fact: "Old", tags: [], pinned: false }) as any)
                    .mockResolvedValueOnce(
                        createMockDoc("u1", {
                            fact: "Old",
                            tags: ["upper"],
                            pinned: false,
                            relatedTo: [],
                            expiresAt: null,
                            createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                            updatedAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                        }) as any
                    ),
                update: jest.fn().mockResolvedValue(undefined),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            await store.update("u1", { tags: ["UPPER", "MiXeD"] });

            expect(mockDocRef.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    tags: ["upper", "mixed"],
                })
            );
        });

        it("should handle empty string tags gracefully", async () => {
            mockCollection.add.mockResolvedValue({ id: "t2" });

            await store.add({ fact: "Test", tags: ["", "valid", ""] });

            const call = mockCollection.add.mock.calls[0][0];
            expect(call.tags).toContain("valid");
        });
    });

    // ═════════════════════════════════════════════════════════
    // BULK ADD
    // ═════════════════════════════════════════════════════════

    describe("Bulk Add", () => {
        it("should clamp to 20 items max", async () => {
            const items = Array.from({ length: 30 }, (_, i) => ({ fact: `fact-${i}` }));

            // Mock doc to return a ref with an id
            mockCollection.doc.mockReturnValue({ id: "doc-id" });

            const result = await store.addBulk(items);

            // Should only process 20, not 30
            expect(mockBatch.set).toHaveBeenCalledTimes(20);
            expect(result.succeeded).toBe(20);
        });

        it("should handle empty input array", async () => {
            const result = await store.addBulk([]);

            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(result.succeeded).toBe(0);
            expect(result.failed).toBe(0);
        });

        it("should set TTL for items with ttl_hours", async () => {
            mockCollection.doc.mockReturnValue({ id: "doc-ttl" });

            await store.addBulk([{ fact: "Temp", ttl_hours: 2 }]);

            const setCall = mockBatch.set.mock.calls[0][1];
            expect(setCall.expiresAt).toBeDefined();
            expect(setCall.expiresAt).not.toBeNull();
        });

        it("should set expiresAt to null for items without ttl_hours", async () => {
            mockCollection.doc.mockReturnValue({ id: "doc-no-ttl" });

            await store.addBulk([{ fact: "Permanent" }]);

            const setCall = mockBatch.set.mock.calls[0][1];
            expect(setCall.expiresAt).toBeNull();
        });
    });

    // ═════════════════════════════════════════════════════════
    // BULK DELETE
    // ═════════════════════════════════════════════════════════

    describe("Bulk Delete", () => {
        it("should clamp to 20 items max", async () => {
            const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);

            const mockDocRef = {
                get: jest.fn().mockResolvedValue(createMockDoc("x", { fact: "y" })),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.deleteBulk(ids);

            // Should only process 20
            expect(result.succeeded).toBe(20);
        });

        it("should report errors for non-existent documents", async () => {
            const mockDocRef = {
                get: jest.fn().mockResolvedValue(createMockDoc("ghost", {}, false)),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.deleteBulk(["ghost"]);

            expect(result.succeeded).toBe(0);
            expect(result.failed).toBe(1);
            expect(result.errors[0]).toContain("not found");
        });

        it("should handle empty ID array", async () => {
            const result = await store.deleteBulk([]);

            expect(mockBatch.commit).not.toHaveBeenCalled();
            expect(result.succeeded).toBe(0);
        });

        it("should handle mix of existing and non-existing docs", async () => {
            const mockDocRef1 = {
                get: jest.fn().mockResolvedValue(createMockDoc("exists", { fact: "yes" })),
            };
            const mockDocRef2 = {
                get: jest.fn().mockResolvedValue(createMockDoc("ghost", {}, false)),
            };

            mockCollection.doc
                .mockReturnValueOnce(mockDocRef1)
                .mockReturnValueOnce(mockDocRef2);

            const result = await store.deleteBulk(["exists", "ghost"]);

            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(1);
        });
    });

    // ═════════════════════════════════════════════════════════
    // LINK / UNLINK
    // ═════════════════════════════════════════════════════════

    describe("Link & Unlink", () => {
        it("should throw when linking with a non-existent first memory", async () => {
            const mockDocRef1 = {
                get: jest.fn().mockResolvedValue(createMockDoc("missing", {}, false)),
            };
            const mockDocRef2 = {
                get: jest.fn().mockResolvedValue(createMockDoc("exists", { fact: "y" })),
            };

            mockCollection.doc
                .mockReturnValueOnce(mockDocRef1)
                .mockReturnValueOnce(mockDocRef2);

            await expect(store.link("missing", "exists")).rejects.toThrow("not found");
        });

        it("should throw when linking with a non-existent second memory", async () => {
            const mockDocRef1 = {
                get: jest.fn().mockResolvedValue(createMockDoc("exists", { fact: "y" })),
            };
            const mockDocRef2 = {
                get: jest.fn().mockResolvedValue(createMockDoc("missing", {}, false)),
            };

            mockCollection.doc
                .mockReturnValueOnce(mockDocRef1)
                .mockReturnValueOnce(mockDocRef2);

            await expect(store.link("exists", "missing")).rejects.toThrow("not found");
        });

        it("should link two existing memories bidirectionally", async () => {
            const mockDocRef1 = {
                get: jest.fn().mockResolvedValue(createMockDoc("a", { fact: "ya" })),
            };
            const mockDocRef2 = {
                get: jest.fn().mockResolvedValue(createMockDoc("b", { fact: "yb" })),
            };

            mockCollection.doc
                .mockReturnValueOnce(mockDocRef1)
                .mockReturnValueOnce(mockDocRef2)
                // For the batch.update calls
                .mockReturnValueOnce({ id: "a" })
                .mockReturnValueOnce({ id: "b" });

            await store.link("a", "b");

            expect(mockBatch.update).toHaveBeenCalledTimes(2);
            expect(mockBatch.commit).toHaveBeenCalled();
        });

        it("should unlink without throwing even if memories don't exist", async () => {
            // unlink doesn't check existence — it just runs the update
            mockCollection.doc.mockReturnValue({ id: "any" });

            await store.unlink("x", "y");

            expect(mockBatch.update).toHaveBeenCalledTimes(2);
            expect(mockBatch.commit).toHaveBeenCalled();
        });
    });

    // ═════════════════════════════════════════════════════════
    // GET RELATED
    // ═════════════════════════════════════════════════════════

    describe("getRelated()", () => {
        it("should throw when source memory doesn't exist", async () => {
            mockCollection.get.mockResolvedValue(createMockSnapshot([]));

            await expect(store.getRelated("missing")).rejects.toThrow("not found");
        });

        it("should return empty array when memory has no relations", async () => {
            const soloDoc = createMockDoc("solo", { relatedTo: [] });
            mockCollection.get.mockResolvedValue(createMockSnapshot([soloDoc]));

            const result = await store.getRelated("solo");
            expect(result).toEqual([]);
        });

        it("should skip expired related memories", async () => {
            const pastDate = new Date(Date.now() - 100000).toISOString();
            const sourceDoc = createMockDoc("src", { relatedTo: ["expired-one"] });
            const expiredDoc = createMockDoc("expired-one", {
                fact: "Old",
                tags: [],
                pinned: false,
                relatedTo: [],
                expiresAt: createMockTimestamp(pastDate),
                createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                updatedAt: null,
            });

            mockCollection.get.mockResolvedValue(createMockSnapshot([sourceDoc, expiredDoc]));

            const result = await store.getRelated("src");
            expect(result).toEqual([]);
        });

        it("should skip related memories that no longer exist", async () => {
            const sourceDoc = createMockDoc("src", { relatedTo: ["deleted-one"] });

            mockCollection.get.mockResolvedValue(createMockSnapshot([sourceDoc]));

            const result = await store.getRelated("src");
            expect(result).toEqual([]);
        });

        it("should return valid related memories", async () => {
            const sourceDoc = createMockDoc("src", { relatedTo: ["rel1"] });
            const relDoc = createMockDoc("rel1", {
                fact: "Related fact",
                tags: ["test"],
                pinned: false,
                relatedTo: ["src"],
                expiresAt: null,
                createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                updatedAt: null,
            });

            mockCollection.get.mockResolvedValue(createMockSnapshot([sourceDoc, relDoc]));

            const result = await store.getRelated("src");
            expect(result).toHaveLength(1);
            expect(result[0].fact).toBe("Related fact");
        });
    });

    // ═════════════════════════════════════════════════════════
    // EXPORT
    // ═════════════════════════════════════════════════════════

    describe("exportAll()", () => {
        it("should export empty collection", async () => {
            mockCollection.get.mockResolvedValue(createMockSnapshot([]));

            const result = await store.exportAll();

            expect(result.count).toBe(0);
            expect(result.memories).toEqual([]);
            expect(result.userId).toBe("test-user");
            expect(result.version).toBeDefined();
        });

        it("should export all memories with metadata", async () => {
            const docs = [
                createMockDoc("e1", {
                    fact: "Fact 1",
                    tags: ["a"],
                    pinned: true,
                    relatedTo: ["e2"],
                    expiresAt: null,
                    createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                    updatedAt: createMockTimestamp("2026-02-01T00:00:00Z"),
                }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const result = await store.exportAll();

            expect(result.count).toBe(1);
            expect(result.memories[0].id).toBe("e1");
            expect(result.memories[0].pinned).toBe(true);
            expect(result.memories[0].relatedTo).toEqual(["e2"]);
        });
    });

    // ═════════════════════════════════════════════════════════
    // IMPORT
    // ═════════════════════════════════════════════════════════

    describe("importAll()", () => {
                it("should import memories in merge mode, skipping existing", async () => {
                    // Simulate existing doc for merge check
                    const existingSnap = createMockDoc("m1", { fact: "exists" });
                    mockDb.getAll.mockResolvedValue([existingSnap]);    
                    mockCollection.doc.mockReturnValue({ id: "m1" });   
        
                    const importData = {
                        version: "2.3.0",
                        exportedAt: new Date().toISOString(),
                        userId: "test",
                        count: 1,
                        memories: [
                            { id: "m1", fact: "New fact", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null },
                            { id: "m3", fact: "New fact 3", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null },
                        ],
                    };
        
                    const result = await store.importAll(importData, "merge");
        
                    expect(result.failed).toBe(1);
                    expect(result.errors[0]).toContain("already exists");
                });
        it("should import new memories in merge mode", async () => {
            // No existing docs
            const nonExistingSnap = createMockDoc("m2", {}, false);
            mockDb.getAll.mockResolvedValue([nonExistingSnap]);
            mockCollection.doc.mockReturnValue({ id: "m2" });

            const importData = {
                version: "2.3.0",
                exportedAt: new Date().toISOString(),
                userId: "test",
                count: 1,
                memories: [
                    { id: "m2", fact: "Brand new", tags: ["test"], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null },
                ],
            };

            const result = await store.importAll(importData, "merge");

            expect(result.succeeded).toBe(1);
            expect(mockBatch.set).toHaveBeenCalled();
        });

        it("should clear existing memories in replace mode", async () => {
            const existingDocs = [
                createMockDoc("old1", { fact: "bye" }),
                createMockDoc("old2", { fact: "bye2" }),
            ];
            mockCollection.get.mockResolvedValueOnce(createMockSnapshot(existingDocs));
            mockCollection.doc.mockReturnValue({ id: "new1" });

            const importData = {
                version: "2.3.0",
                exportedAt: new Date().toISOString(),
                userId: "test",
                count: 1,
                memories: [
                    { id: "new1", fact: "Replacement", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null },
                ],
            };

            const result = await store.importAll(importData, "replace");

            // First batch: delete, second batch: import
            expect(mockDb.batch).toHaveBeenCalledTimes(2);
            expect(result.succeeded).toBe(1);
        });

        it("should handle empty import data gracefully", async () => {
            const importData = {
                version: "2.3.0",
                exportedAt: new Date().toISOString(),
                userId: "test",
                count: 0,
                memories: [],
            };

            const result = await store.importAll(importData, "merge");

            expect(result.succeeded).toBe(0);
            expect(result.failed).toBe(0);
        });
    });

    // ═════════════════════════════════════════════════════════
    // CLEANUP EXPIRED
    // ═════════════════════════════════════════════════════════

    describe("cleanupExpired()", () => {
        it("should return 0 when no expired memories exist", async () => {
            mockCollection.get.mockResolvedValue(createMockSnapshot([]));

            const count = await store.cleanupExpired();

            expect(count).toBe(0);
            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

                        it("should delete expired memories and return count", async () => {
                            const expiredDocs = [
                                createMockDoc("exp1", { fact: "old1" }),        
                                createMockDoc("exp2", { fact: "old2" }),        
                                createMockDoc("exp3", { fact: "old3" }),        
                            ];
                            
                            mockCollection.get.mockResolvedValueOnce(createMockSnapshot(expiredDocs));
                
                            const count = await store.cleanupExpired();        
                    expect(count).toBe(3);
                    expect(mockBatch.delete).toHaveBeenCalledTimes(3);  
                    expect(mockBatch.commit).toHaveBeenCalled();        
                });    });

    // ═════════════════════════════════════════════════════════
    // PAGINATION
    // ═════════════════════════════════════════════════════════

    describe("Pagination", () => {
        it("should clamp limit to 200 max (returns at most 200 items)", async () => {
            // Create 210 docs
            const docs = Array.from({ length: 210 }, (_, i) =>
                createMockDoc(`p${i}`, {
                    fact: `fact-${i}`,
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                    updatedAt: null,
                })
            );
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.getAll({ limit: 999 });

            expect(results.length).toBeLessThanOrEqual(200);
        });

        it("should default to 50 if no limit specified", async () => {
            const docs = Array.from({ length: 60 }, (_, i) =>
                createMockDoc(`d${i}`, {
                    fact: `fact-${i}`,
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                    updatedAt: null,
                })
            );
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.getAll({});

            expect(results.length).toBe(50);
        });

        it("should skip items based on offset", async () => {
            const docs = Array.from({ length: 10 }, (_, i) =>
                createMockDoc(`o${i}`, {
                    fact: `fact-${i}`,
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                    updatedAt: null,
                })
            );
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.getAll({ offset: 5, limit: 50 });

            expect(results.length).toBe(5); // 10 total, skip 5 = 5 remaining
        });
    });

    // ═════════════════════════════════════════════════════════
    // SMART SEARCH EDGE CASES
    // ═════════════════════════════════════════════════════════

    describe("smartSearch() — Edge Cases", () => {
        it("should handle empty query", async () => {
            const result = await store.smartSearch("");
            expect(result).toHaveLength(0);
        });

        it("should handle whitespace-only query", async () => {
            const result = await store.smartSearch("   ");
            expect(result).toHaveLength(0);
        });

        it("should match tags in addition to fact", async () => {
            const docs = [
                createMockDoc("1", {
                    fact: "Some generic text",
                    tags: ["typescript", "react"],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: null,
                    updatedAt: null,
                }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.smartSearch("typescript");

            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it("should exclude expired memories from results", async () => {
            const pastDate = new Date(Date.now() - 100000).toISOString();
            const docs = [
                createMockDoc("1", {
                    fact: "Exact match query",
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: createMockTimestamp(pastDate),
                    createdAt: null,
                    updatedAt: null,
                }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.smartSearch("Exact match query");

            expect(results).toHaveLength(0);
        });

        it("should handle special characters in query without crashing", async () => {
            const docs = [
                createMockDoc("1", {
                    fact: "Regular text",
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: null,
                    updatedAt: null,
                }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            // These should not throw
            await store.smartSearch("test (with) [brackets]");
            await store.smartSearch("regex.*special+chars?");
            await store.smartSearch("emoji 🚀 search");
        });

        it("should sort results by relevance descending", async () => {
            const docs = [
                createMockDoc("1", { fact: "Unrelated content here", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("2", { fact: "Searching for dark mode theme", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("3", { fact: "dark mode", tags: ["theme"], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.smartSearch("dark mode");

            // Results should be sorted — exact match first
            if (results.length >= 2) {
                expect(results[0].relevance).toBeGreaterThanOrEqual(results[1].relevance);
            }
        });
    });

    // ═════════════════════════════════════════════════════════
    // DATA INTEGRITY — docToMemory
    // ═════════════════════════════════════════════════════════

    describe("docToMemory — Data Integrity", () => {
        it("should handle missing fact field gracefully", async () => {
            const mockDoc = createMockDoc("no-fact", {
                tags: [],
                pinned: false,
                relatedTo: [],
                expiresAt: null,
                createdAt: null,
                updatedAt: null,
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("no-fact");
            expect(result!.fact).toBe("");
        });

        it("should handle non-array tags gracefully", async () => {
            const mockDoc = createMockDoc("bad-tags", {
                fact: "Test",
                tags: "not-an-array",
                pinned: false,
                relatedTo: [],
                expiresAt: null,
                createdAt: null,
                updatedAt: null,
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("bad-tags");
            expect(Array.isArray(result!.tags)).toBe(true);
            expect(result!.tags).toEqual([]);
        });

        it("should handle non-array relatedTo gracefully", async () => {
            const mockDoc = createMockDoc("bad-related", {
                fact: "Test",
                tags: [],
                pinned: false,
                relatedTo: "not-an-array",
                expiresAt: null,
                createdAt: null,
                updatedAt: null,
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("bad-related");
            expect(Array.isArray(result!.relatedTo)).toBe(true);
            expect(result!.relatedTo).toEqual([]);
        });

        it("should handle pinned as non-boolean gracefully", async () => {
            const mockDoc = createMockDoc("bad-pin", {
                fact: "Test",
                tags: [],
                pinned: "yes",
                relatedTo: [],
                expiresAt: null,
                createdAt: null,
                updatedAt: null,
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("bad-pin");
            expect(result!.pinned).toBe(false);
        });

        it("should handle missing timestamp fields", async () => {
            const mockDoc = createMockDoc("no-times", {
                fact: "Test",
                tags: [],
                pinned: false,
                relatedTo: [],
                expiresAt: null,
                // createdAt and updatedAt missing entirely
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("no-times");
            expect(result!.createdAt).toBeNull();
            expect(result!.updatedAt).toBeNull();
        });
    });
});
