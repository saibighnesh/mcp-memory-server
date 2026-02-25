"use client";

import { useState, useEffect } from "react";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    doc,
    deleteDoc,
    updateDoc,
    Timestamp,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import type { Memory, MemoryStats } from "./types";
import { useAuth } from "@/components/AuthProvider";

// The hardcoded USER_ID is removed in favor of dynamic IDs from Firebase Auth

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToMemory(d: any): Memory {
    const data = d.data();
    const createdAt = data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt ?? null;
    const updatedAt = data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt ?? null;
    const expiresAt = data.expiresAt instanceof Timestamp
        ? data.expiresAt.toDate().toISOString()
        : data.expiresAt ?? null;

    return {
        id: d.id,
        fact: data.fact ?? "",
        tags: data.tags ?? [],
        pinned: data.pinned ?? false,
        relatedTo: data.relatedTo ?? [],
        expiresAt,
        createdAt,
        updatedAt,
    };
}

/** Real-time listener for all memories, sorted pinned-first then newest. */
export function useMemories() {
    const { user } = useAuth();
    const userId = user?.uid;
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) {
            return;
        }

        const q = query(
            collection(db, "users", userId, "memories"),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(docToMemory);
            // Stable sort: pinned first
            data.sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return 0;
            });
            setMemories(data);
            setLoading(false);
        });

        return unsubscribe;
    }, [userId]);

    return {
        memories: userId ? memories : [],
        loading: userId ? loading : false
    };
}

/** Computed stats from the memory list. */
export function useStats(memories: Memory[]): MemoryStats {
    const now = new Date();
    const hourFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const pinned = memories.filter((m) => m.pinned).length;
    const expiringSoon = memories.filter((m) => {
        if (!m.expiresAt) return false;
        const exp = new Date(m.expiresAt);
        return exp > now && exp < hourFromNow;
    }).length;

    const tags: Record<string, number> = {};
    for (const m of memories) {
        for (const t of m.tags) {
            tags[t] = (tags[t] || 0) + 1;
        }
    }

    const timestamps = memories
        .map((m) => m.createdAt)
        .filter(Boolean)
        .map((t) => new Date(t!).getTime());

    return {
        total: memories.length,
        pinned,
        expiringSoon,
        tags,
        newestTimestamp: timestamps.length > 0
            ? new Date(Math.max(...timestamps)).toISOString()
            : null,
        oldestTimestamp: timestamps.length > 0
            ? new Date(Math.min(...timestamps)).toISOString()
            : null,
    };
}

/** Delete a memory from Firestore. */
export async function deleteMemory(id: string) {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("Not authenticated");
    await deleteDoc(doc(db, "users", userId, "memories", id));
}

/** Toggle pin status. */
export async function togglePin(id: string, currentPinned: boolean) {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("Not authenticated");
    await updateDoc(doc(db, "users", userId, "memories", id), {
        pinned: !currentPinned,
    });
}

/** Update a memory's fact and tags. */
export async function updateMemory(
    id: string,
    updates: { fact?: string; tags?: string[] }
) {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("Not authenticated");
    await updateDoc(doc(db, "users", userId, "memories", id), {
        ...updates,
        updatedAt: Timestamp.now(),
    });
}
