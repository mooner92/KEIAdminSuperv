import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import type { GraphData } from "../lib/vault";
import { useTheme } from "../lib/theme";
import styles from "../styles/Graph.module.css";

// react-force-graph는 canvas/window 의존 → 클라이언트에서만 로드
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div className={styles.loading}>그래프 불러오는 중…</div>,
});

const SECTION_COLOR: Record<string, string> = {
  규정집: "#3182f6",
  가이드: "#03b26c",
  용어집: "#fe9800",
  시스템: "#8b5cf6",
};

export default function GraphCanvas({
  graph,
  onNodeSelect,
  selectedId,
}: {
  graph: GraphData;
  /** 주어지면 노드 클릭 시 페이지 이동 대신 이 콜백(분할 뷰). 없으면 기존대로 문서 페이지로 이동 */
  onNodeSelect?: (slug: string) => void;
  /** 분할 뷰에서 현재 선택된 노드(링 강조) */
  selectedId?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const [size, setSize] = useState({ w: 900, h: 600 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(420, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={styles.canvas}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ForceGraph2D
        width={size.w}
        height={size.h}
        graphData={graph as never}
        nodeId="id"
        nodeLabel="title"
        nodeRelSize={4}
        nodeVal={(n: any) => 1 + (n.deg || 0)}
        nodeColor={(n: any) => SECTION_COLOR[n.section] || "#8b95a1"}
        linkColor={() => (dark ? "rgba(233,237,243,0.16)" : "rgba(25,31,40,0.10)")}
        linkWidth={1}
        backgroundColor={dark ? "#20242c" : "#ffffff"}
        cooldownTicks={120}
        onNodeClick={(n: any) =>
          onNodeSelect ? onNodeSelect(String(n.id)) : router.push(`/d/${n.id}/`)
        }
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(node: any, ctx: any, scale: number) => {
          // 선택된 노드(분할 뷰)는 링으로 강조 — 줌 무관하게 항상
          if (selectedId && String(node.id) === selectedId) {
            const r = Math.sqrt(1 + (node.deg || 0)) * 4 + 2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.strokeStyle = "#3182f6";
            ctx.lineWidth = 2.5 / scale;
            ctx.stroke();
          }
          // 충분히 확대됐을 때만 라벨 표시(겹침 방지)
          if (scale < 2.2) return;
          const label = String(node.title);
          ctx.font = `${11 / scale}px -apple-system, sans-serif`;
          ctx.fillStyle = dark ? "#c2c9d2" : "#4e5968";
          ctx.textBaseline = "middle";
          ctx.fillText(label, node.x + (Math.sqrt(1 + (node.deg || 0)) * 4 + 2) / scale, node.y);
        }}
      />
    </div>
  );
}
