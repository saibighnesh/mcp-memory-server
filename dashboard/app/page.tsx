"use client";

import Sidebar from "@/components/Sidebar";
import { useMemories, useStats } from "@/lib/firestore";
import type { Memory } from "@/lib/types";
import {
  Brain,
  Pin,
  Clock,
  Tag,
  TrendingUp,
  Sparkles,
} from "lucide-react";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            {label}
          </p>
          <p className="text-3xl font-bold mt-1" style={{ color }}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{subtitle}</p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}15` }}
        >
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
    </div>
  );
}

function TagCloud({ tags }: { tags: Record<string, number> }) {
  const sorted = Object.entries(tags)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">No tags yet</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map(([tag, count]) => (
        <span key={tag} className="tag-badge">
          {tag}
          <span className="ml-1.5 text-[var(--color-text-muted)]">{count}</span>
        </span>
      ))}
    </div>
  );
}

function RecentActivity({ memories }: { memories: Memory[] }) {
  const recent = memories.slice(0, 8);

  return (
    <div className="space-y-2">
      {recent.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
        >
          {m.pinned && <Pin className="w-3.5 h-3.5 text-[var(--color-accent)] flex-shrink-0" />}
          {!m.pinned && <Brain className="w-3.5 h-3.5 text-[var(--color-primary)] flex-shrink-0" />}
          <p className="text-sm truncate flex-1">{m.fact}</p>
          <div className="flex gap-1 flex-shrink-0">
            {m.tags.slice(0, 2).map((t: string) => (
              <span key={t} className="tag-badge text-[10px]">{t}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MemoryTimeline({ memories }: { memories: Memory[] }) {
  // Group by date
  const groups: Record<string, number> = {};
  for (const m of memories) {
    if (m.createdAt) {
      const day = m.createdAt.split("T")[0];
      groups[day] = (groups[day] || 0) + 1;
    }
  }

  const days = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14);

  if (days.length === 0) return null;

  const maxCount = Math.max(...days.map(([, c]) => c));

  return (
    <div className="flex items-end gap-1 h-24">
      {days.map(([day, count]) => (
        <div key={day} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t-sm bg-[var(--color-primary)] transition-all hover:bg-[var(--color-primary)]/80"
            style={{ height: `${(count / maxCount) * 80}px`, minHeight: "4px" }}
            title={`${day}: ${count} memories`}
          />
          <span className="text-[8px] text-[var(--color-text-muted)] rotate-[-45deg] origin-center">
            {day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

import { useAuth } from "@/components/AuthProvider";

export default function DashboardPage() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const { memories, loading: memoriesLoading } = useMemories(user?.uid);
  const stats = useStats(memories);

  if (authLoading || memoriesLoading) {
    return (
      <div className="flex">
        <Sidebar />
        <main className="ml-64 flex-1 p-8">
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass p-8 max-w-sm w-full text-center space-y-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <Brain className="w-8 h-8 text-[var(--color-primary)]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold">MCP Memory Server</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-2">
              Sign in to view your personal AI memory dashboard
            </p>
          </div>
          <button
            onClick={signInWithGoogle}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      <Sidebar />
      <main className="ml-64 flex-1 p-8 min-h-screen">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[var(--color-primary)]" />
            Memory Dashboard
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Real-time overview of your AI memory system
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Memories"
            value={stats.total}
            icon={Brain}
            color="#3b82f6"
          />
          <StatCard
            label="Pinned"
            value={stats.pinned}
            icon={Pin}
            color="#f59e0b"
          />
          <StatCard
            label="Expiring Soon"
            value={stats.expiringSoon}
            icon={Clock}
            color={stats.expiringSoon > 0 ? "#ef4444" : "#10b981"}
            subtitle="Within 24 hours"
          />
          <StatCard
            label="Unique Tags"
            value={Object.keys(stats.tags).length}
            icon={Tag}
            color="#8b5cf6"
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Timeline + Tags */}
          <div className="lg:col-span-1 space-y-6">
            {/* Timeline */}
            <div className="glass p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--color-primary)]" />
                Memory Timeline
              </h3>
              <MemoryTimeline memories={memories} />
            </div>

            {/* Tags */}
            <div className="glass p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Tag className="w-4 h-4 text-purple-400" />
                Top Tags
              </h3>
              <TagCloud tags={stats.tags} />
            </div>
          </div>

          {/* Right column: Recent Activity */}
          <div className="lg:col-span-2">
            <div className="glass p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Brain className="w-4 h-4 text-[var(--color-primary)]" />
                Recent Memories
              </h3>
              <RecentActivity memories={memories} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
