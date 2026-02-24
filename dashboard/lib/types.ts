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

export interface ScoredMemory extends Memory {
    relevance: number;
}

export interface MemoryStats {
    total: number;
    pinned: number;
    expiringSoon: number;
    tags: Record<string, number>;
    newestTimestamp: string | null;
    oldestTimestamp: string | null;
}
