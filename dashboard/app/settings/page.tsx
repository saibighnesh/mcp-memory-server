"use client";

import { useMemories, useStats } from "@/lib/firestore";
import { Settings as SettingsIcon, Server, Database, Cpu, Terminal, Copy, CheckCircle2 } from "lucide-react";
import { useState } from "react";

function CopyBlock({ code, title }: { code: string; title: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="mt-4 border border-[var(--color-border)] rounded-xl overflow-hidden bg-[#0d1117]">
            <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[var(--color-border)]">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">{title}</span>
                <button
                    onClick={handleCopy}
                    className="text-[var(--color-text-muted)] hover:text-white transition-colors"
                    title="Copy to clipboard"
                >
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
            </div>
            <pre className="p-4 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap">
                {code}
            </pre>
        </div>
    );
}

export default function SettingsPage() {
    const { memories } = useMemories();
    const stats = useStats(memories);

    const sections = [
        {
            title: "Server Info",
            icon: Server,
            items: [
                { label: "Server Version", value: "v2.3.0" },
                { label: "Total Tools", value: "15" },
                { label: "Protocol", value: "MCP (Model Context Protocol)" },
            ],
        },
        {
            title: "Database",
            icon: Database,
            items: [
                { label: "Provider", value: "Cloud Firestore" },
                { label: "Project", value: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "Connected" },
                { label: "Total Memories", value: String(stats.total) },
                { label: "Pinned", value: String(stats.pinned) },
                { label: "Unique Tags", value: String(Object.keys(stats.tags).length) },
            ],
        },
        {
            title: "AI / Embeddings",
            icon: Cpu,
            items: [
                { label: "Embedding Model", value: "Gemini text-embedding-004" },
                { label: "Vector Dimensions", value: "768" },
                { label: "Search Method", value: "Firestore findNearest (cosine)" },
                { label: "GEMINI_API_KEY", value: "Set via environment variable" },
            ],
        },
    ];

    const claudeConfig = `{
  "mcpServers": {
    "firebase-shared-memory": {
      "command": "node",
      "args": [
        "C:/absolute/path/to/mcp-memory-server/dist/index.js",
        "--user-id=YOUR_USERNAME"
      ]
    }
  }
}`;

    const cursorConfig = `Type: command
Name: firebase-shared-memory
Command: node C:/absolute/path/to/mcp-memory-server/dist/index.js --user-id=YOUR_USERNAME`;

    return (
        <>
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <SettingsIcon className="w-6 h-6 text-[var(--color-primary)]" />
                    Settings
                </h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                    Server configuration and system information
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                <div className="space-y-6">
                    {sections.map(({ title, icon: Icon, items }) => (
                        <div key={title} className="glass p-5">
                            <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                <Icon className="w-4 h-4 text-[var(--color-primary)]" />
                                {title}
                            </h2>
                            <div className="space-y-3">
                                {items.map(({ label, value }) => (
                                    <div
                                        key={label}
                                        className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
                                    >
                                        <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
                                        <span className="text-sm font-medium">{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="space-y-6">
                    <div className="glass p-5">
                        <h2 className="font-semibold text-sm flex items-center gap-2 mb-2">
                            <Terminal className="w-4 h-4 text-[var(--color-primary)]" />
                            Connection Guide (LLM Clients)
                        </h2>
                        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                            Connect your AI assistant to this memory server. Replace <code className="text-[var(--color-primary)]">YOUR_USERNAME</code> with your unique ID, and update the file path to point to your <code className="text-white">dist/index.js</code> file.
                        </p>

                        <CopyBlock title="Claude Desktop / Windsurf / Gemini CLI config.json" code={claudeConfig} />

                        <CopyBlock title="Cursor IDE (Settings -> Features -> MCP)" code={cursorConfig} />
                    </div>
                </div>
            </div>
        </>
    );
}

