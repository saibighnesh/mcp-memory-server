/**
 * Shared TypeScript types for OmniBrain MCP.
 */

/** A memory document as stored in Firestore. */
export interface Memory {
  id: string;
  fact: string;
  tags: string[];
  pinned: boolean;
  relatedTo: string[];
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Memory with an attached relevance score (returned from smart search). */
export interface ScoredMemory extends Memory {
  relevance: number;
}

/** Input shape for creating a new memory. */
export interface AddMemoryInput {
  fact: string;
  tags?: string[];
  pinned?: boolean;
  ttl_hours?: number;
}

/** Input shape for updating an existing memory. */
export interface UpdateMemoryInput {
  fact?: string;
  tags?: string[];
  pinned?: boolean;
}

/** Pagination options for list queries. */
export interface PaginationOptions {
  /** Max number of results to return (default: 50, max: 200). */
  limit?: number;
  /** Number of results to skip (default: 0). */
  offset?: number;
}

/** Aggregate stats for the memory collection. */
export interface MemoryStats {
  totalCount: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
}

/** Validated server configuration. */
export interface ServerConfig {
  userId: string;
  serviceAccountPath: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  cohereApiKey?: string;
  cohereModel?: string;
  embeddingProvider?: string;
}

/** Result of a bulk operation. */
export interface BulkResult {
  succeeded: number;
  failed: number;
  ids: string[];
  errors: string[];
}

/** Export/Import data shape. */
export interface ExportData {
  version: string;
  exportedAt: string;
  userId: string;
  count: number;
  memories: Memory[];
}
