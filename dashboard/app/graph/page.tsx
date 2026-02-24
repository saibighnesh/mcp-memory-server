"use client";

import Sidebar from "@/components/Sidebar";
import { useMemories } from "@/lib/firestore";
import { Network } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { Memory } from "@/lib/types";

interface GraphNode extends d3.SimulationNodeDatum {
    id: string;
    fact: string;
    pinned: boolean;
    tags: string[];
    linkCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
    source: string | GraphNode;
    target: string | GraphNode;
}

function buildGraph(memories: Memory[]) {
    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    for (const m of memories) {
        nodeMap.set(m.id, {
            id: m.id,
            fact: m.fact.slice(0, 60) + (m.fact.length > 60 ? "..." : ""),
            pinned: m.pinned,
            tags: m.tags,
            linkCount: m.relatedTo.length,
        });
    }

    for (const m of memories) {
        for (const relId of m.relatedTo) {
            if (nodeMap.has(relId)) {
                // Avoid duplicates
                const exists = links.some(
                    (l) =>
                        (l.source === m.id && l.target === relId) ||
                        (l.source === relId && l.target === m.id)
                );
                if (!exists) {
                    links.push({ source: m.id, target: relId });
                }
            }
        }
    }

    return { nodes: Array.from(nodeMap.values()), links };
}

function ForceGraph({ memories }: { memories: Memory[] }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    useEffect(() => {
        if (!svgRef.current || memories.length === 0) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        const width = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight;

        const { nodes, links } = buildGraph(memories);

        const simulation = d3
            .forceSimulation<GraphNode>(nodes)
            .force(
                "link",
                d3
                    .forceLink<GraphNode, GraphLink>(links)
                    .id((d) => d.id)
                    .distance(100)
            )
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(30));

        // Links
        const link = svg
            .append("g")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke", "rgba(59, 130, 246, 0.3)")
            .attr("stroke-width", 1.5);

        // Nodes
        const node = svg
            .append("g")
            .selectAll("circle")
            .data(nodes)
            .join("circle")
            .attr("r", (d) => 6 + d.linkCount * 3)
            .attr("fill", (d) => (d.pinned ? "#f59e0b" : "#3b82f6"))
            .attr("stroke", (d) => (d.pinned ? "#f59e0b" : "#3b82f6"))
            .attr("stroke-width", 2)
            .attr("fill-opacity", 0.6)
            .attr("cursor", "pointer")
            .on("click", (_, d) => setSelectedNode(d))
            .call(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                d3.drag<any, GraphNode>()
                    .on("start", (event, d) => {
                        if (!event.active) simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    })
                    .on("drag", (event, d) => {
                        d.fx = event.x;
                        d.fy = event.y;
                    })
                    .on("end", (event, d) => {
                        if (!event.active) simulation.alphaTarget(0);
                        d.fx = null;
                        d.fy = null;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any
            );

        // Labels
        const labels = svg
            .append("g")
            .selectAll("text")
            .data(nodes)
            .join("text")
            .text((d) => d.fact.slice(0, 25) + (d.fact.length > 25 ? "…" : ""))
            .attr("font-size", 9)
            .attr("fill", "#94a3b8")
            .attr("dx", 14)
            .attr("dy", 4);

        simulation.on("tick", () => {
            link
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .attr("x1", (d: any) => d.source.x)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .attr("y1", (d: any) => d.source.y)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .attr("x2", (d: any) => d.target.x)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .attr("y2", (d: any) => d.target.y);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            labels.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
        });

        // Zoom
        const zoom = d3
            .zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.3, 3])
            .on("zoom", (event) => {
                svg.selectAll("g").attr("transform", event.transform);
            });

        svg.call(zoom);

        return () => {
            simulation.stop();
        };
    }, [memories]);

    return (
        <div className="relative w-full h-full">
            <svg
                ref={svgRef}
                className="w-full h-full"
                style={{ background: "transparent" }}
            />

            {/* Legend */}
            <div className="absolute top-4 left-4 glass p-3 text-xs space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--color-accent)]" />
                    <span>Pinned</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--color-primary)]" />
                    <span>Regular</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-6 h-[2px] bg-[var(--color-primary)]/40" />
                    <span>Link</span>
                </div>
            </div>

            {/* Selected node detail */}
            {selectedNode && (
                <div className="absolute bottom-4 right-4 glass p-4 max-w-xs">
                    <button
                        onClick={() => setSelectedNode(null)}
                        className="absolute top-2 right-2 text-[var(--color-text-muted)]"
                    >
                        ✕
                    </button>
                    <p className="text-sm font-medium mb-2">{selectedNode.fact}</p>
                    <div className="flex flex-wrap gap-1">
                        {selectedNode.tags.map((t) => (
                            <span key={t} className="tag-badge text-[10px]">{t}</span>
                        ))}
                    </div>
                    {selectedNode.pinned && (
                        <p className="text-xs text-[var(--color-accent)] mt-2">📌 Pinned</p>
                    )}
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        🔗 {selectedNode.linkCount} connections
                    </p>
                </div>
            )}
        </div>
    );
}

export default function GraphPage() {
    const { memories, loading } = useMemories();

    const linkedMemories = memories.filter((m) => m.relatedTo.length > 0);
    const hasGraph = linkedMemories.length > 0 || memories.length > 0;

    return (
        <div className="flex">
            <Sidebar />
            <main className="ml-64 flex-1 p-8 min-h-screen">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Network className="w-6 h-6 text-[var(--color-primary)]" />
                        Knowledge Graph
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Interactive visualization of memory relationships
                    </p>
                </div>

                <div className="glass overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : !hasGraph ? (
                        <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
                            <Network className="w-12 h-12 mb-3 opacity-30" />
                            <p className="text-sm">No memories to visualize</p>
                            <p className="text-xs mt-1">Add memories via MCP to see them here</p>
                        </div>
                    ) : (
                        <ForceGraph memories={memories} />
                    )}
                </div>
            </main>
        </div>
    );
}
