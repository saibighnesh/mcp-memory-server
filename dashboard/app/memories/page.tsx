"use client";

import Sidebar from "@/components/Sidebar";
import { useMemories, deleteMemory, togglePin, updateMemory } from "@/lib/firestore";
import { Pin, Trash2, Search, Brain, Edit3, Check, X } from "lucide-react";
import { useState } from "react";
import type { Memory } from "@/lib/types";

function MemoryRow({
    memory,
    onDelete,
}: {
    memory: Memory;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [editFact, setEditFact] = useState(memory.fact);

    const handleSave = async () => {
        if (editFact.trim() && editFact !== memory.fact) {
            await updateMemory(memory.id, { fact: editFact.trim() });
        }
        setEditing(false);
    };

    const isExpiring = memory.expiresAt && new Date(memory.expiresAt) > new Date();

    return (
        <tr className="border-b border-[var(--color-border)] hover:bg-white/[0.02] transition-colors group">
            {/* Pin */}
            <td className="p-3 w-10">
                <button
                    onClick={() => togglePin(memory.id, memory.pinned)}
                    className={`transition-colors ${memory.pinned ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                        }`}
                    title={memory.pinned ? "Unpin" : "Pin"}
                >
                    <Pin className="w-4 h-4" fill={memory.pinned ? "currentColor" : "none"} />
                </button>
            </td>

            {/* Fact */}
            <td className="p-3">
                {editing ? (
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 bg-white/5 border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                            value={editFact}
                            onChange={(e) => setEditFact(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleSave();
                                if (e.key === "Escape") setEditing(false);
                            }}
                        />
                        <button onClick={handleSave} className="text-[var(--color-success)]">
                            <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditing(false)} className="text-[var(--color-danger)]">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <p className="text-sm">{memory.fact}</p>
                )}
            </td>

            {/* Tags */}
            <td className="p-3">
                <div className="flex flex-wrap gap-1">
                    {memory.tags.map((t) => (
                        <span key={t} className="tag-badge text-[10px]">{t}</span>
                    ))}
                </div>
            </td>

            {/* Status */}
            <td className="p-3 text-xs text-[var(--color-text-muted)]">
                {isExpiring && (
                    <span className="text-[var(--color-danger)]">⏰ Expires</span>
                )}
                {memory.relatedTo.length > 0 && (
                    <span className="text-[var(--color-primary)]">
                        🔗 {memory.relatedTo.length}
                    </span>
                )}
            </td>

            {/* Created */}
            <td className="p-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                {memory.createdAt
                    ? new Date(memory.createdAt).toLocaleDateString()
                    : "—"}
            </td>

            {/* Actions */}
            <td className="p-3 w-20">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => { setEditFact(memory.fact); setEditing(true); }}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white transition-colors"
                    >
                        <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => onDelete(memory.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-danger)]/10 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

export default function MemoriesPage() {
    const { memories, loading } = useMemories();
    const [searchQuery, setSearchQuery] = useState("");
    const [filterTag, setFilterTag] = useState<string | null>(null);
    const [filterPinned, setFilterPinned] = useState(false);

    const allTags = [...new Set(memories.flatMap((m) => m.tags))].sort();

    const filtered = memories.filter((m) => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (!m.fact.toLowerCase().includes(q) && !m.tags.some((t) => t.includes(q))) {
                return false;
            }
        }
        if (filterTag && !m.tags.includes(filterTag)) return false;
        if (filterPinned && !m.pinned) return false;
        return true;
    });

    const handleDelete = async (id: string) => {
        if (confirm("Delete this memory?")) {
            await deleteMemory(id);
        }
    };

    return (
        <div className="flex">
            <Sidebar />
            <main className="ml-64 flex-1 p-8 min-h-screen">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Brain className="w-6 h-6 text-[var(--color-primary)]" />
                        Memory Explorer
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Browse, search, and manage all memories
                    </p>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3 mb-6">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <input
                            type="text"
                            placeholder="Search memories..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                        />
                    </div>

                    <button
                        onClick={() => setFilterPinned(!filterPinned)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${filterPinned
                                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25"
                                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                            }`}
                    >
                        <Pin className="w-3.5 h-3.5" />
                        Pinned
                    </button>

                    <select
                        value={filterTag ?? ""}
                        onChange={(e) => setFilterTag(e.target.value || null)}
                        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-xs text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
                    >
                        <option value="">All Tags</option>
                        {allTags.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>

                    <span className="text-xs text-[var(--color-text-muted)]">
                        {filtered.length} of {memories.length}
                    </span>
                </div>

                {/* Table */}
                <div className="glass overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center h-48">
                            <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-muted)]">
                            <Brain className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">No memories found</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                                    <th className="p-3 w-10"></th>
                                    <th className="p-3 text-left">Fact</th>
                                    <th className="p-3 text-left">Tags</th>
                                    <th className="p-3 text-left">Status</th>
                                    <th className="p-3 text-left">Created</th>
                                    <th className="p-3 w-20"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((m) => (
                                    <MemoryRow key={m.id} memory={m} onDelete={handleDelete} />
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
}
