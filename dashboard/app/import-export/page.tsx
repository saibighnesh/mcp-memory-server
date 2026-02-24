"use client";

import Sidebar from "@/components/Sidebar";
import { useMemories } from "@/lib/firestore";
import { ArrowUpDown, Download, Upload, FileJson } from "lucide-react";

export default function ImportExportPage() {
    const { memories, loading } = useMemories();

    const handleExport = () => {
        const exportData = {
            version: "2.3.0",
            exportedAt: new Date().toISOString(),
            count: memories.length,
            memories: memories.map((m) => ({
                id: m.id,
                fact: m.fact,
                tags: m.tags,
                pinned: m.pinned,
                relatedTo: m.relatedTo,
                expiresAt: m.expiresAt,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
            })),
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mcp-memories-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex">
            <Sidebar />
            <main className="ml-64 flex-1 p-8 min-h-screen">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ArrowUpDown className="w-6 h-6 text-[var(--color-primary)]" />
                        Import & Export
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Backup and restore your memory data
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Export */}
                    <div className="glass p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-[var(--color-success)]/10 flex items-center justify-center">
                                <Download className="w-5 h-5 text-[var(--color-success)]" />
                            </div>
                            <div>
                                <h2 className="font-semibold">Export Memories</h2>
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    Download all memories as JSON
                                </p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] rounded-lg p-4 mb-4 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[var(--color-text-muted)]">Total memories</span>
                                <span className="font-medium">{loading ? "..." : memories.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-[var(--color-text-muted)]">Format</span>
                                <span className="font-medium flex items-center gap-1">
                                    <FileJson className="w-3.5 h-3.5" /> JSON
                                </span>
                            </div>
                        </div>

                        <button
                            onClick={handleExport}
                            disabled={loading || memories.length === 0}
                            className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-success)] text-white font-medium text-sm hover:bg-[var(--color-success)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Export All Memories
                        </button>
                    </div>

                    {/* Import */}
                    <div className="glass p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
                                <Upload className="w-5 h-5 text-[var(--color-primary)]" />
                            </div>
                            <div>
                                <h2 className="font-semibold">Import Memories</h2>
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    Use the MCP import_memories tool
                                </p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] rounded-lg p-4 mb-4 text-sm">
                            <p className="text-[var(--color-text-muted)]">
                                To import memories, use the <code className="text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-1.5 py-0.5 rounded">import_memories</code> MCP tool with your exported JSON data.
                            </p>
                            <p className="text-[var(--color-text-muted)] mt-2">
                                Supports <strong>merge</strong> (skip existing) and <strong>replace</strong> (overwrite all) modes.
                            </p>
                        </div>


                    </div>
                </div>
            </main>
        </div>
    );
}
