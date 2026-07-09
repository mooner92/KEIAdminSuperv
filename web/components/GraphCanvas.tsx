import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import type { GraphData } from "../lib/vault";
import { useTheme } from "../lib/theme";
import { useFlag } from "../lib/flags";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const upgrades = useFlag("explore_upgrades"); // v1 ⑭(S7-#32): 노드 검색·전체보기
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(false);
  const router = useRouter();

  // 노드 검색: norm 매칭 첫 노드로 카메라 이동 + 선택(분할 뷰 문서 패널 연동)
  const norm = (t: string) => t.toLowerCase().replace(/[\s･·,]/g, "");
  const jumpTo = () => {
    const t = norm(q.trim());
    if (!t) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: any = (graph.nodes as any[]).find((n) => norm(n.title || "").includes(t));
    if (!node || node.x == null) { setMiss(true); setTimeout(() => setMiss(false), 1500); return; }
    setMiss(false);
    onNodeSelect?.(String(node.id)); // 문서 패널 먼저(카메라 실패와 무관하게 동작 보장)
    try {
      fgRef.current?.centerAt(node.x, node.y, 600);
      fgRef.current?.zoom(3.2, 600);
    } catch { /* dynamic ref 미전달 등 — 선택만으로도 기능 성립 */ }
  };
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
      {upgrades ? (
        <div className={styles.graphTools}>
          <input
            className={styles.graphSearch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) jumpTo(); }}
            placeholder="노드 검색 (예: 복무규정)"
            aria-label="노드 검색"
          />
          <button className={styles.graphBtn} onClick={jumpTo}>이동</button>
          <button className={styles.graphBtn} onClick={() => fgRef.current?.zoomToFit(600, 40)} aria-label="전체보기">
            ⛶ 전체보기
          </button>
          {miss ? <span className={styles.graphMiss}>일치하는 노드 없음</span> : null}
        </div>
      ) : null}
      <ForceGraph2D
        ref={fgRef}
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
