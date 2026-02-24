"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Brain,
    Network,
    ArrowUpDown,
    Search,
    Settings,
    Sparkles,
} from "lucide-react";

const NAV_ITEMS = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/memories", label: "Memories", icon: Brain },
    { href: "/graph", label: "Knowledge Graph", icon: Network },
    { href: "/import-export", label: "Import / Export", icon: ArrowUpDown },
    { href: "/search", label: "Semantic Search", icon: Search },
    { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="fixed left-0 top-0 h-screen w-64 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-glass)]  backdrop-blur-xl z-50">
            {/* Logo */}
            <div className="p-6 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-purple-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                    <h1 className="font-bold text-sm text-white">MCP Memory</h1>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Dashboard v2.3</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-2 space-y-1">
                {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                    const isActive = pathname === href;
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
                                    ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/25"
                                    : "text-[var(--color-text-muted)] hover:text-white hover:bg-white/5"
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--color-border)]">
                <div className="flex items-center gap-2 px-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
                    <span className="text-xs text-[var(--color-text-muted)]">Connected to Firestore</span>
                </div>
            </div>
        </aside>
    );
}
