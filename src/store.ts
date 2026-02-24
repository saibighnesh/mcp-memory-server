/**
 * Firestore-backed memory store.
 *
 * Encapsulates all database operations with retry logic for transient errors.
 * Supports: CRUD, pinning, smart/semantic search, bulk ops, export/import, linking, TTL.
 */

import fs from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "./logger.js";
import type { EmbeddingService } from "./embeddings.js";
import type {
    Memory,
    ScoredMemory,
    AddMemoryInput,
    UpdateMemoryInput,
    PaginationOptions,
    MemoryStats,
    BulkResult,
    ExportData,
    ServerConfig,
} from "./types.js";

// Firestore gRPC status codes that are safe to retry
const RETRYABLE_CODES = new Set([14 /* UNAVAILABLE */, 4 /* DEADLINE_EXCEEDED */]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Execute a Firestore operation with exponential-backoff retry for transient errors.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            const code = err?.code as number | undefined;

            if (attempt < MAX_RETRIES && code !== undefined && RETRYABLE_CODES.has(code)) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                logger.warn(`Retryable error in ${label} (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`, {
                    code,
                    message: err.message,
                });
                await new Promise((r) => setTimeout(r, delay));
            } else {
                break;
            }
        }
    }

    throw lastError;
}

/**
 * Maps a Firestore document snapshot to our Memory interface.
 */
function docToMemory(doc: FirebaseFirestore.DocumentSnapshot): Memory {
    const data = doc.data()!;
    return {
        id: doc.id,
        fact: data.fact ?? "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        pinned: data.pinned === true,
        relatedTo: Array.isArray(data.relatedTo) ? data.relatedTo : [],
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
}

/**
 * Check if a memory has expired.
 */
function isExpired(memory: Memory): boolean {
    if (!memory.expiresAt) return false;
    return new Date(memory.expiresAt) < new Date();
}

/**
 * Smart relevance scoring — tokenizes query into words and scores each memory.
 */
function computeRelevance(fact: string, query: string, tags: string[] = []): number {
    const factLower = fact.toLowerCase();
    const queryLower = query.toLowerCase();

    // Exact full match → 1.0
    if (factLower.includes(queryLower)) return 1.0;

    // Word-based scoring
    const queryWords = queryLower.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;

    // Include tags in the searchable word set
    const factWords = new Set(factLower.split(/\s+/).filter(Boolean));
    for (const tag of tags) {
        factWords.add(tag.toLowerCase());
    }
    let matchedWords = 0;
    let partialScore = 0;

    for (const qw of queryWords) {
        // Exact word match
        if (factWords.has(qw)) {
            matchedWords++;
            continue;
        }
        // Partial word match (word starts with query word, or query word contained in a fact word)
        let bestPartial = 0;
        for (const fw of factWords) {
            if (fw.includes(qw)) {
                bestPartial = Math.max(bestPartial, qw.length / fw.length);
            } else if (qw.includes(fw)) {
                bestPartial = Math.max(bestPartial, fw.length / qw.length);
            }
        }
        partialScore += bestPartial;
    }

    // Full word matches contribute 0.8 max, partial matches fill the rest
    const wordScore = (matchedWords / queryWords.length) * 0.8;
    const partialWordScore = (partialScore / queryWords.length) * 0.4;

    return Math.min(wordScore + partialWordScore, 0.95);
}

export class FirestoreMemoryStore {
    private collection: FirebaseFirestore.CollectionReference;
    private db: FirebaseFirestore.Firestore;
    private userId: string;
    private embeddings: EmbeddingService | null;

    // In-memory cache for all memories to dramatically speed up reads
    private cache: Memory[] | null = null;
    private cacheTimestamp: number = 0;
    private CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(db: FirebaseFirestore.Firestore, userId: string, embeddings: EmbeddingService | null = null) {
        this.db = db;
        this.userId = userId;
        this.embeddings = embeddings;
        this.collection = db.collection("users").doc(userId).collection("memories");
        logger.info(`Memory store initialized for user: ${userId}`);
    }

    /** Whether semantic search is available. */
    get hasEmbeddings(): boolean {
        return this.embeddings !== null;
    }

    /** Helper to get all memories, utilizing the cache. */
    private async getCachedMemories(): Promise<Memory[]> {
        if (this.cache && (Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS)) {
            return this.cache;
        }
        const snapshot = await this.collection.get();
        this.cache = snapshot.docs.map(docToMemory);
        this.cacheTimestamp = Date.now();
        return this.cache;
    }

    /** Invalidate the in-memory cache. */
    private invalidateCache() {
        this.cache = null;
        this.cacheTimestamp = 0;
    }

    // ── CRUD ────────────────────────────────────────────────────────

    /** Add a new memory with optional tags, pinning, and TTL. Returns the new document ID. */
    async add(input: AddMemoryInput): Promise<string> {
        return withRetry("add", async () => {
            const data: Record<string, unknown> = {
                fact: input.fact,
                tags: (input.tags ?? []).map(t => t.toLowerCase()),
                pinned: input.pinned ?? false,
                relatedTo: [],
                expiresAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            // Compute expiry if TTL is provided
            if (input.ttl_hours !== undefined && input.ttl_hours > 0) {
                const expiresAt = new Date(Date.now() + input.ttl_hours * 60 * 60 * 1000);
                data.expiresAt = Timestamp.fromDate(expiresAt);
            }

            // Generate embedding vector if service available
            if (this.embeddings) {
                try {
                    const vector = await this.embeddings.embed(input.fact);
                    if (vector.length > 0) {
                        data.embedding = FieldValue.vector(vector);
                    }
                } catch (err: any) {
                    logger.warn(`Embedding failed for add, skipping: ${err.message}`);
                }
            }

            const docRef = await this.collection.add(data);
            logger.debug(`Added memory: ${docRef.id}`);
            this.invalidateCache();
            return docRef.id;
        });
    }

    /** Fetch a single memory by document ID. Returns null if not found or expired. */
    async getById(id: string): Promise<Memory | null> {
        return withRetry("getById", async () => {
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) return null;
            const memory = docToMemory(doc);
            if (isExpired(memory)) return null;
            return memory;
        });
    }

    /** Retrieve memories with pagination. Pinned memories come first, then newest. */
    async getAll(options: PaginationOptions = {}): Promise<Memory[]> {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const offset = Math.max(options.offset ?? 0, 0);

        return withRetry("getAll", async () => {
            // Single query, sort by createdAt, then reorder in-memory for pinned-first
            const allDocs = await this.getCachedMemories();
            const all = allDocs
                .filter((m) => !isExpired(m))
                .sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime;
                });

            // Stable sort: pinned first, then by original order (newest first)
            all.sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return 0; // preserve original desc order
            });

            return all.slice(offset, offset + limit);
        });
    }

    /** Case-insensitive substring search across all memory facts. */
    async search(query: string): Promise<Memory[]> {
        return withRetry("search", async () => {
            const allDocs = await this.getCachedMemories();
            const lowerQuery = query.toLowerCase();

            return allDocs
                .filter((m) => !isExpired(m))
                .filter((m) => m.fact.toLowerCase().includes(lowerQuery));
        });
    }

    /** Smart search with relevance scoring. Returns results sorted by score. */
    async smartSearch(query: string): Promise<ScoredMemory[]> {
        return withRetry("smartSearch", async () => {
            const allDocs = await this.getCachedMemories();

            const scored = [];
            for (const memory of allDocs) {
                if (isExpired(memory)) continue;

                const relevance = computeRelevance(memory.fact, query, memory.tags);
                if (relevance >= 0.2) {
                    scored.push({ ...memory, relevance: Math.round(relevance * 100) / 100 });
                }
            }

            // Also match in tags
            const queryLower = query.toLowerCase();
            for (const sm of scored) {
                if (sm.tags.some((t) => t.includes(queryLower))) {
                    sm.relevance = Math.min(sm.relevance + 0.15, 1.0);
                    sm.relevance = Math.round(sm.relevance * 100) / 100;
                }
            }

            return scored.sort((a, b) => b.relevance - a.relevance);
        });
    }

    /** Search memories by tags using Firestore array-contains-any. */
    async searchByTags(tags: string[]): Promise<Memory[]> {
        if (tags.length === 0) return [];

        // Firestore limits array-contains-any to 30 values
        const queryTags = tags.slice(0, 30).map((t) => t.toLowerCase());

        return withRetry("searchByTags", async () => {
            const snapshot = await this.collection
                .where("tags", "array-contains-any", queryTags)
                .get();

            return snapshot.docs.map(docToMemory).filter((m) => !isExpired(m));
        });
    }

    /** Semantic search using Firestore vector findNearest() with cosine distance. */
    async semanticSearch(queryVector: number[], limit: number = 10): Promise<ScoredMemory[]> {
        return withRetry("semanticSearch", async () => {
            const vectorQuery = this.collection.findNearest({
                vectorField: "embedding",
                queryVector: queryVector,
                limit: limit,
                distanceMeasure: "COSINE",
                distanceResultField: "vector_distance",
            });

            const snapshot = await vectorQuery.get();

            return snapshot.docs
                .map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
                    const memory = docToMemory(doc);
                    if (isExpired(memory)) return null;
                    // Cosine distance to similarity: 1 - distance
                    const distance = doc.get("vector_distance") as number ?? 0;
                    const relevance = Math.round((1 - distance) * 100) / 100;
                    return { ...memory, relevance };
                })
                .filter((m): m is ScoredMemory => m !== null && m.relevance > 0.3);
        });
    }

    /** Update an existing memory's fact, tags, and/or pinned status. Throws if not found. */
    async update(id: string, updates: UpdateMemoryInput): Promise<Memory> {
        return withRetry("update", async () => {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error(`Memory with ID ${id} not found.`);
            }

            const updateData: Record<string, unknown> = {
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (updates.fact !== undefined) updateData.fact = updates.fact;
            if (updates.tags !== undefined) updateData.tags = updates.tags.map((t) => t.toLowerCase());
            if (updates.pinned !== undefined) updateData.pinned = updates.pinned;

            // Re-embed if fact changed and embedding service is available
            if (updates.fact !== undefined && this.embeddings) {
                try {
                    const vector = await this.embeddings.embed(updates.fact);
                    if (vector.length > 0) {
                        updateData.embedding = FieldValue.vector(vector);
                    }
                } catch (err: any) {
                    logger.warn(`Re-embedding failed for update, skipping: ${err.message}`);
                }
            }

            await docRef.update(updateData);
            this.invalidateCache();

            // Re-fetch to return the updated document
            const updated = await docRef.get();
            return docToMemory(updated);
        });
    }

    /** Delete a memory by ID. Returns true if deleted, false if not found. */
    async delete(id: string): Promise<boolean> {
        return withRetry("delete", async () => {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();

            if (!doc.exists) return false;

            await docRef.delete();
            this.invalidateCache();
            logger.debug(`Deleted memory: ${id}`);
            return true;
        });
    }

    // ── PIN ──────────────────────────────────────────────────────────

    /** Toggle the pinned status of a memory. Returns the updated memory. */
    async togglePin(id: string): Promise<Memory> {
        return withRetry("togglePin", async () => {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();

            if (!doc.exists) throw new Error(`Memory with ID ${id} not found.`);

            const currentPinned = doc.data()?.pinned === true;
            await docRef.update({
                pinned: !currentPinned,
                updatedAt: FieldValue.serverTimestamp(),
            });

            const updated = await docRef.get();
            return docToMemory(updated);
        });
    }

    // ── BULK ─────────────────────────────────────────────────────────

    /** Add multiple memories in a single batch (max 20). */
    async addBulk(inputs: AddMemoryInput[]): Promise<BulkResult> {
        const clamped = inputs.slice(0, 20);
        const batch = this.db.batch();
        const ids: string[] = [];
        const errors: string[] = [];

        // Generate embeddings in batch if available
        let embeddings: number[][] = [];
        if (this.embeddings) {
            try {
                embeddings = await this.embeddings.embedBatch(clamped.map(i => i.fact));
            } catch (err: any) {
                logger.warn(`Batch embedding failed, skipping embeddings for bulk add: ${err.message}`);
            }
        }

        for (let i = 0; i < clamped.length; i++) {
            const input = clamped[i];
            try {
                const docRef = this.collection.doc();
                const data: Record<string, unknown> = {
                    fact: input.fact,
                    tags: input.tags ?? [],
                    pinned: input.pinned ?? false,
                    relatedTo: [],
                    expiresAt: null,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };

                if (input.ttl_hours !== undefined && input.ttl_hours > 0) {
                    const expiresAt = new Date(Date.now() + input.ttl_hours * 60 * 60 * 1000);
                    data.expiresAt = Timestamp.fromDate(expiresAt);
                }

                if (embeddings[i] && embeddings[i].length > 0) {
                    data.embedding = FieldValue.vector(embeddings[i]);
                }

                batch.set(docRef, data);
                ids.push(docRef.id);
            } catch (err: any) {
                errors.push(err.message);
            }
        }

        await batch.commit();
            this.invalidateCache();
        logger.info(`Bulk added ${ids.length} memories`);

        return {
            succeeded: ids.length,
            failed: errors.length,
            ids,
            errors,
        };
    }

    /** Delete multiple memories in a single batch (max 20). */
    async deleteBulk(memoryIds: string[]): Promise<BulkResult> {
        const clamped = memoryIds.slice(0, 20);
        const batch = this.db.batch();
        const ids: string[] = [];
        const errors: string[] = [];

        for (const id of clamped) {
            const docRef = this.collection.doc(id);
            const doc = await docRef.get();
            if (doc.exists) {
                batch.delete(docRef);
                ids.push(id);
            } else {
                errors.push(`${id}: not found`);
            }
        }

        if (ids.length > 0) await batch.commit();
            this.invalidateCache();
        logger.info(`Bulk deleted ${ids.length} memories`);

        return {
            succeeded: ids.length,
            failed: errors.length,
            ids,
            errors,
        };
    }

    // ── EXPORT / IMPORT ──────────────────────────────────────────────

    /** Export all memories as a structured JSON blob. */
    async exportAll(): Promise<ExportData> {
        return withRetry("exportAll", async () => {
            const allDocs = await this.getCachedMemories();
            const memories = allDocs
                .sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime;
                });

            return {
                version: "2.2.0",
                exportedAt: new Date().toISOString(),
                userId: this.userId,
                count: memories.length,
                memories,
            };
        });
    }

    /** Import memories from an export blob. mode: "merge" skips existing IDs, "replace" wipes and writes. */
    async importAll(data: ExportData, mode: "merge" | "replace"): Promise<BulkResult> {
        const ids: string[] = [];
        const errors: string[] = [];

        if (mode === "replace") {
            // Delete all existing memories first
            const existing = await this.collection.get();
            const deleteBatch = this.db.batch();
            for (const doc of existing.docs) {
                deleteBatch.delete(doc.ref);
            }
            if (existing.docs.length > 0) await deleteBatch.commit();
            logger.info(`Cleared ${existing.docs.length} existing memories for replace import`);
        }

        // Import in batches of 20 (Firestore batch limit is 500 but we chunk for safety)
        const chunks = [];
        for (let i = 0; i < data.memories.length; i += 20) {
            chunks.push(data.memories.slice(i, i + 20));
        }

        for (const chunk of chunks) {
            const batch = this.db.batch();

            // Check existing docs efficiently for merge mode
            const existingDocs = new Map<string, boolean>();
            if (mode === "merge" && chunk.length > 0) {
                const refs = chunk.map((m) => this.collection.doc(m.id));
                const snapshots = await this.db.getAll(...refs);
                snapshots.forEach((snap) => {
                    if (snap.exists) existingDocs.set(snap.id, true);
                });
            }

            // Generate embeddings for chunk
            let embeddings: number[][] = [];
            if (this.embeddings) {
                try {
                    embeddings = await this.embeddings.embedBatch(chunk.map(m => m.fact));
                } catch (err: any) {
                    logger.warn(`Batch embedding failed for import, skipping embeddings: ${err.message}`);
                }
            }

            for (let i = 0; i < chunk.length; i++) {
                const memory = chunk[i];
                if (mode === "merge" && existingDocs.has(memory.id)) {
                    errors.push(`${memory.id}: already exists (skipped)`);
                    continue;
                }

                const docRef = this.collection.doc(memory.id);
                const data: Record<string, unknown> = {
                    fact: memory.fact,
                    tags: memory.tags ?? [],
                    pinned: memory.pinned ?? false,
                    relatedTo: memory.relatedTo ?? [],
                    expiresAt: memory.expiresAt ? Timestamp.fromDate(new Date(memory.expiresAt)) : null,
                    createdAt: memory.createdAt ? Timestamp.fromDate(new Date(memory.createdAt)) : FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };

                if (embeddings[i] && embeddings[i].length > 0) {
                    data.embedding = FieldValue.vector(embeddings[i]);
                }

                batch.set(docRef, data);
                ids.push(memory.id);
            }
            if (ids.length > 0) await batch.commit();
            this.invalidateCache();
        }

        logger.info(`Imported ${ids.length} memories (mode: ${mode})`);

        return {
            succeeded: ids.length,
            failed: errors.length,
            ids,
            errors,
        };
    }

    // ── RELATIONSHIPS ────────────────────────────────────────────────

    /** Link two memories bidirectionally. */
    async link(id1: string, id2: string): Promise<void> {
        return withRetry("link", async () => {
            const doc1 = await this.collection.doc(id1).get();
            const doc2 = await this.collection.doc(id2).get();

            if (!doc1.exists) throw new Error(`Memory ${id1} not found.`);
            if (!doc2.exists) throw new Error(`Memory ${id2} not found.`);

            const batch = this.db.batch();
            batch.update(this.collection.doc(id1), {
                relatedTo: FieldValue.arrayUnion(id2),
                updatedAt: FieldValue.serverTimestamp(),
            });
            batch.update(this.collection.doc(id2), {
                relatedTo: FieldValue.arrayUnion(id1),
                updatedAt: FieldValue.serverTimestamp(),
            });
            await batch.commit();
            this.invalidateCache();

            logger.debug(`Linked memories: ${id1} <-> ${id2}`);
        });
    }

    /** Unlink two memories bidirectionally. */
    async unlink(id1: string, id2: string): Promise<void> {
        return withRetry("unlink", async () => {
            const batch = this.db.batch();
            batch.update(this.collection.doc(id1), {
                relatedTo: FieldValue.arrayRemove(id2),
                updatedAt: FieldValue.serverTimestamp(),
            });
            batch.update(this.collection.doc(id2), {
                relatedTo: FieldValue.arrayRemove(id1),
                updatedAt: FieldValue.serverTimestamp(),
            });
            await batch.commit();
            this.invalidateCache();

            logger.debug(`Unlinked memories: ${id1} <-> ${id2}`);
        });
    }

    /** Get all memories related to a given memory. */
    async getRelated(id: string): Promise<Memory[]> {
        return withRetry("getRelated", async () => {
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) throw new Error(`Memory ${id} not found.`);

            const relatedIds: string[] = doc.data()?.relatedTo ?? [];
            if (relatedIds.length === 0) return [];

            const results: Memory[] = [];
            for (const rid of relatedIds) {
                const rdoc = await this.collection.doc(rid).get();
                if (rdoc.exists) {
                    const m = docToMemory(rdoc);
                    if (!isExpired(m)) results.push(m);
                }
            }
            return results;
        });
    }

    // ── STATS & CLEANUP ──────────────────────────────────────────────

    /** Aggregate stats: total count, oldest and newest timestamps. */
    async getStats(): Promise<MemoryStats> {
        return withRetry("getStats", async () => {
            // Get count
            const countSnap = await this.collection.count().get();
            const totalCount = countSnap.data().count;

            if (totalCount === 0) {
                return { totalCount: 0, oldestTimestamp: null, newestTimestamp: null };
            }

            // Get oldest
            const oldestSnap = await this.collection.orderBy("createdAt", "asc").limit(1).get();
            const oldestDoc = oldestSnap.docs[0];
            const oldestTimestamp = oldestDoc?.data()?.createdAt?.toDate?.()?.toISOString() ?? null;

            // Get newest
            const newestSnap = await this.collection.orderBy("createdAt", "desc").limit(1).get();
            const newestDoc = newestSnap.docs[0];
            const newestTimestamp = newestDoc?.data()?.createdAt?.toDate?.()?.toISOString() ?? null;

            return { totalCount, oldestTimestamp, newestTimestamp };
        });
    }

    /** Delete all expired memories. Returns the number deleted. */
    async cleanupExpired(): Promise<number> {
        return withRetry("cleanupExpired", async () => {
            const now = Timestamp.now();
            const snapshot = await this.collection
                .where("expiresAt", "<=", now)
                .where("expiresAt", "!=", null)
                .get();

            if (snapshot.empty) return 0;

            const batch = this.db.batch();
            for (const doc of snapshot.docs) {
                batch.delete(doc.ref);
            }
            await batch.commit();
            this.invalidateCache();

            logger.info(`Cleaned up ${snapshot.size} expired memories`);
            return snapshot.size;
        });
    }
}

/**
 * Initialize the Firebase app and return a configured FirestoreMemoryStore.
 */
export function initFirestore(config: ServerConfig, embeddings: EmbeddingService | null = null): FirestoreMemoryStore {
    if (!getApps().length) {
        const serviceAccount = JSON.parse(fs.readFileSync(config.serviceAccountPath, "utf8"));
        initializeApp({ credential: cert(serviceAccount) });
    }

    const db = getFirestore();
    return new FirestoreMemoryStore(db, config.userId, embeddings);
}
