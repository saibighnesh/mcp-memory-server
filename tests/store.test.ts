/**
 * Unit tests for FirestoreMemoryStore.
 *
 * All Firestore interactions are mocked — no live Firebase project required.
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

describe("FirestoreMemoryStore", () => {
    let store: FirestoreMemoryStore;
    let mockCollection: any;
    let mockDb: any;

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

        mockDb = {
            collection: jest.fn().mockReturnValue({
                doc: jest.fn().mockReturnValue({
                    collection: jest.fn().mockReturnValue(mockCollection),
                }),
            }),
            batch: jest.fn().mockReturnValue({
                set: jest.fn(),
                delete: jest.fn(),
                update: jest.fn(),
                commit: jest.fn().mockResolvedValue(undefined),
            }),
            getAll: jest.fn().mockResolvedValue([]),
        };

        store = new FirestoreMemoryStore(mockDb as any, "test-user");
    });

    // ── add ────────────────────────────────────────────────────

    describe("add()", () => {
        it("should add a memory with fact, tags, and pinned flag", async () => {
            mockCollection.add.mockResolvedValue({ id: "abc123" });

            const id = await store.add({ fact: "TypeScript is great", tags: ["lang"], pinned: true });

            expect(id).toBe("abc123");
            expect(mockCollection.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    fact: "TypeScript is great",
                    tags: ["lang"],
                    pinned: true,
                    relatedTo: [],
                    expiresAt: null,
                })
            );
        });

        it("should default tags, pinned, and expiresAt when not provided", async () => {
            mockCollection.add.mockResolvedValue({ id: "def456" });

            await store.add({ fact: "No extras" });

            expect(mockCollection.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    tags: [],
                    pinned: false,
                    relatedTo: [],
                    expiresAt: null,
                })
            );
        });

        it("should compute expiresAt when ttl_hours is provided", async () => {
            mockCollection.add.mockResolvedValue({ id: "ttl1" });

            await store.add({ fact: "Temporary", ttl_hours: 24 });

            const call = mockCollection.add.mock.calls[0][0];
            expect(call.expiresAt).toBeDefined();
            expect(call.expiresAt).not.toBeNull();
        });
    });

    // ── getById ────────────────────────────────────────────────

    describe("getById()", () => {
        it("should return a memory when found", async () => {
            const mockDoc = createMockDoc("id1", {
                fact: "Hello",
                tags: ["test"],
                pinned: false,
                relatedTo: [],
                expiresAt: null,
                createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                updatedAt: createMockTimestamp("2026-01-02T00:00:00Z"),
            });

            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const memory = await store.getById("id1");

            expect(memory).toEqual({
                id: "id1",
                fact: "Hello",
                tags: ["test"],
                pinned: false,
                relatedTo: [],
                expiresAt: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
            });
        });

        it("should return null when not found", async () => {
            mockCollection.get.mockResolvedValue(createMockSnapshot([]));

            const result = await store.getById("missing");

            expect(result).toBeNull();
        });

        it("should return null for expired memories", async () => {
            const pastDate = new Date(Date.now() - 1000);
            const mockDoc = createMockDoc("expired1", {
                fact: "Old",
                tags: [],
                pinned: false,
                relatedTo: [],
                expiresAt: createMockTimestamp(pastDate.toISOString()),
                createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                updatedAt: null,
            });
            mockCollection.get.mockResolvedValue(createMockSnapshot([mockDoc]));

            const result = await store.getById("expired1");

            expect(result).toBeNull();
        });
    });

    // ── search ─────────────────────────────────────────────────

    describe("search()", () => {
        it("should filter memories case-insensitively and exclude expired", async () => {
            const docs = [
                createMockDoc("1", { fact: "TypeScript is great", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("2", { fact: "Python is cool", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("3", { fact: "I love TYPESCRIPT", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.search("typescript");

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe("1");
            expect(results[1].id).toBe("3");
        });

        it("should return empty array when nothing matches", async () => {
            const docs = [
                createMockDoc("1", { fact: "Hello world", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.search("zzzzz");

            expect(results).toHaveLength(0);
        });
    });

    // ── smartSearch ────────────────────────────────────────────

    describe("smartSearch()", () => {
        it("should score exact matches highest", async () => {
            const docs = [
                createMockDoc("1", { fact: "The meaning of life is 42", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("2", { fact: "Meaning is subjective", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
                createMockDoc("3", { fact: "Unrelated content here", tags: [], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.smartSearch("meaning of life");

            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].id).toBe("1");
            expect(results[0].relevance).toBe(1.0);
        });

        it("should return partial word matches with lower scores", async () => {
            const docs = [
                createMockDoc("1", { fact: "User prefers dark mode", tags: ["preference"], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.smartSearch("dark preference settings");

            expect(results.length).toBe(1);
            expect(results[0].relevance).toBeLessThan(1.0);
            expect(results[0].relevance).toBeGreaterThan(0);
        });
    });

    // ── searchByTags ───────────────────────────────────────────

    describe("searchByTags()", () => {
        it("should filter tags in-memory via cache", async () => {
            const docs = [
                createMockDoc("1", { fact: "Tagged", tags: ["dev"], pinned: false, relatedTo: [], expiresAt: null, createdAt: null, updatedAt: null }),
            ];
            mockCollection.get.mockResolvedValue(createMockSnapshot(docs));

            const results = await store.searchByTags(["dev", "test"]);

            expect(results).toHaveLength(1);
        });

        it("should return empty array for empty tags", async () => {
            const results = await store.searchByTags([]);
            expect(results).toHaveLength(0);
        });
    });

    // ── update ─────────────────────────────────────────────────

    describe("update()", () => {
        it("should update fact, tags, and pinned on an existing document", async () => {
            const mockDocRef = {
                get: jest.fn()
                    .mockResolvedValueOnce(createMockDoc("u1", { fact: "old", tags: [], pinned: false }) as any)
                    .mockResolvedValueOnce(
                        createMockDoc("u1", {
                            fact: "new fact",
                            tags: ["updated"],
                            pinned: true,
                            relatedTo: [],
                            expiresAt: null,
                            createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                            updatedAt: createMockTimestamp("2026-02-01T00:00:00Z"),
                        }) as any
                    ),
                update: jest.fn().mockResolvedValue(undefined),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.update("u1", { fact: "new fact", tags: ["Updated"], pinned: true });

            expect(mockDocRef.update).toHaveBeenCalledWith(
                expect.objectContaining({ fact: "new fact", tags: ["updated"], pinned: true })
            );
            expect(result.fact).toBe("new fact");
            expect(result.pinned).toBe(true);
        });

        it("should throw when updating a non-existent document", async () => {
            const mockDocRef = {
                get: jest.fn().mockResolvedValue(createMockDoc("missing", {}, false)),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            await expect(store.update("missing", { fact: "nope" })).rejects.toThrow("not found");
        });
    });

    // ── delete ─────────────────────────────────────────────────

    describe("delete()", () => {
        it("should delete an existing document and return true", async () => {
            const mockDocRef = {
                get: jest.fn().mockResolvedValue(createMockDoc("d1", { fact: "bye" })),
                delete: jest.fn().mockResolvedValue(undefined),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.delete("d1");

            expect(result).toBe(true);
            expect(mockDocRef.delete).toHaveBeenCalled();
        });

        it("should return false for a non-existent document", async () => {
            const mockDocRef = {
                get: jest.fn().mockResolvedValue(createMockDoc("missing", {}, false)),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.delete("missing");

            expect(result).toBe(false);
        });
    });

    // ── togglePin ──────────────────────────────────────────────

    describe("togglePin()", () => {
        it("should toggle pinned from false to true", async () => {
            const mockDocRef = {
                get: jest.fn()
                    .mockResolvedValueOnce(createMockDoc("p1", { pinned: false }) as any)
                    .mockResolvedValueOnce(createMockDoc("p1", {
                        fact: "Test", tags: [], pinned: true, relatedTo: [], expiresAt: null,
                        createdAt: createMockTimestamp("2026-01-01T00:00:00Z"),
                        updatedAt: createMockTimestamp("2026-02-01T00:00:00Z"),
                    }) as any),
                update: jest.fn().mockResolvedValue(undefined),
            };
            mockCollection.doc.mockReturnValue(mockDocRef);

            const result = await store.togglePin("p1");

            expect(mockDocRef.update).toHaveBeenCalledWith(
                expect.objectContaining({ pinned: true })
            );
            expect(result.pinned).toBe(true);
        });
    });

    // ── getStats ───────────────────────────────────────────────

    describe("getStats()", () => {
        it("should return zeros for an empty collection", async () => {
            mockCollection.get.mockResolvedValue(createMockSnapshot([]));

            const stats = await store.getStats();

            expect(stats).toEqual({
                totalCount: 0,
                oldestTimestamp: null,
                newestTimestamp: null,
            });
        });

        it("should return count and boundary timestamps", async () => {
            const oldestSnap = createMockDoc("oldest", { createdAt: createMockTimestamp("2025-01-01T00:00:00Z") });
            const newestSnap = createMockDoc("newest", { createdAt: createMockTimestamp("2026-02-23T00:00:00Z") });

            mockCollection.get.mockResolvedValue(createMockSnapshot([oldestSnap, newestSnap]));

            const stats = await store.getStats();

            expect(stats.totalCount).toBe(2);
            expect(stats.oldestTimestamp).toBe("2025-01-01T00:00:00.000Z");
            expect(stats.newestTimestamp).toBe("2026-02-23T00:00:00.000Z");
        });
    });
});
