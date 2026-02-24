"use client";

import Sidebar from "@/components/Sidebar";
import { useMemories } from "@/lib/firestore";
import { Search, Brain, Sparkles } from "lucide-react";
import { useState } from "react";

function computeRelevance(fact: string, tags: string[], query: string): number {
    const text = `${fact} ${tags.join(" ")}`.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;

    let matchedWords = 0;
    let partialScore = 0;
    for (const word of queryWords) {
        if (text.includes(word)) {
            matchedWords++;
        } else {
            let bestPartial = 0;
            for (const factWord of text.split(/\s+/)) {
                if (factWord.startsWith(word) || word.startsWith(factWord)) {
                    bestPartial = Math.max(bestPartial, 0.5);
                }
            }
            partialScore += bestPartial;
        }
    }
    const wordScore = (matchedWords / queryWords.length) * 0.8;
    const partialWordScore = (partialScore / queryWords.length) * 0.4;
    return Math.min(wordScore + partialWordScore, 0.95);
}

export default function SearchPage() {
    const { memories } = useMemories();
    const [query, setQuery] = useState("");

    const results = query.trim()
        ? memories
            .map((m) => ({
                ...m,
                relevance: computeRelevance(m.fact, m.tags, query),
            }))
            .filter((m) => m.relevance > 0)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 20)
        : [];

    return (
        <div className="flex">
            <Sidebar />
            <main className="ml-64 flex-1 p-8 min-h-screen">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-[var(--color-primary)]" />
                        Semantic Search Lab
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Test AI-powered memory search with relevance scoring
                    </p>
                </div>

                {/* Search Input */}
                <div className="relative max-w-2xl mb-8">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search by meaning... e.g. 'user preferences for dark themes'"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl pl-12 pr-6 py-4 text-sm focus:outline-none focus:border-[var(--color-primary)] transition-all focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    />
                </div>

                {/* Results */}
                {query.trim() && (
                    <div className="mb-3 text-xs text-[var(--color-text-muted)]">
                        {results.length} results (smart search — set GEMINI_API_KEY for true semantic search)
                    </div>
                )}

                <div className="space-y-3 max-w-2xl">
                    {results.map((m) => (
                        <div
                            key={m.id}
                            className="glass p-4 animate-fade-in"
                        >
                            <div className="flex items-start gap-4">
                                {/* Relevance bar */}
                                <div className="flex flex-col items-center gap-1 flex-shrink-0 w-14">
                                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all"
                                            style={{
                                                width: `${m.relevance * 100}%`,
                                                background:
                                                    m.relevance > 0.7
                                                        ? "var(--color-success)"
                                                        : m.relevance > 0.4
                                                            ? "var(--color-accent)"
                                                            : "var(--color-danger)",
                                            }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-[var(--color-text-muted)]">
                                        {Math.round(m.relevance * 100)}%
                                    </span>
                                </div>

                                {/* Content */}
                                <div className="flex-1">
                                    <p className="text-sm">{m.fact}</p>
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        {m.pinned && (
                                            <span className="text-[var(--color-accent)] text-xs">📌</span>
                                        )}
                                        {m.tags.map((t) => (
                                            <span key={t} className="tag-badge text-[10px]">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {query.trim() && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-muted)]">
                            <Brain className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">No matching memories found</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
