import Link from "next/link";
import { useMemo, useState } from "react";
import type { GraphData } from "../../lib/vault";
import { track } from "../../lib/track";
import m from "./MobileGraphList.module.css";

// 모바일 그래프 간소 뷰(docs/54 v2) — 캔버스(react-force-graph, 물리 시뮬레이션)는 모바일에서
// 무겁고 조작이 어렵다. 같은 graph 데이터를 리스트로: 문서 검색 → 연결(관련 규정)을 목록으로 펼쳐 이동.
// 그래프의 핵심 가치(관련 규정 찾기)를 캔버스 없이 제공 — react-force-graph를 아예 로드하지 않는다.

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집", 가이드: "가이드", 용어집: "용어집", 시스템: "시스템", 대외업무: "대외업무",
};

function norm(s: string) { return s.toLowerCase().replace(/\s+/g, ""); }

export default function MobileGraphList({ graph }: { graph: GraphData }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  // 이웃 인덱스: id → 연결된 노드 id[](양방향).
  // ⚠ react-force-graph(데스크톱 캔버스)가 공유 pageProps의 link.source/target를 노드 '객체'로
  // 변형할 수 있다 → 문자열/객체 모두에서 id를 뽑아 정규화(sid).
  const neighbors = useMemo(() => {
    const sid = (x: unknown): string =>
      (typeof x === "string" ? x : (x as { id?: string })?.id) || "";
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!a || !b) return;
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)!.add(b);
    };
    for (const l of graph.links) {
      const a = sid(l.source), b = sid(l.target);
      add(a, b); add(b, a);
    }
    return map;
  }, [graph.links]);

  const byId = useMemo(() => {
    const m2 = new Map<string, GraphData["nodes"][number]>();
    for (const n of graph.nodes) m2.set(n.id, n);
    return m2;
  }, [graph.nodes]);

  // 연결 많은 순 → 검색어 필터. 고립 노드(deg 0)는 뒤로.
  const shown = useMemo(() => {
    const t = norm(q);
    const list = t ? graph.nodes.filter((n) => norm(n.title).includes(t)) : graph.nodes;
    return [...list].sort((a, b) => b.deg - a.deg || a.title.localeCompare(b.title));
  }, [q, graph.nodes]);

  return (
    <div className={m.wrap}>
      <input className={m.search} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="규정·문서 이름으로 찾기" aria-label="문서 검색" />
      <p className={m.count}>{shown.length}개 문서 · 연결 많은 순</p>
      <ul className={m.list}>
        {shown.slice(0, 200).map((n) => {
          const nb = [...(neighbors.get(n.id) || [])]
            .map((id) => byId.get(id)).filter(Boolean)
            .sort((a, b) => (b!.deg - a!.deg));
          const isOpen = open === n.id;
          return (
            <li key={n.id} className={m.item}>
              <button className={m.row} onClick={() => setOpen(isOpen ? null : n.id)}
                aria-expanded={isOpen} disabled={n.deg === 0}>
                <span className={m.dot} data-section={n.section} aria-hidden />
                <span className={m.title}>{n.title}</span>
                <span className={m.deg}>{n.deg > 0 ? `${n.deg}` : "—"}</span>
                {n.deg > 0 ? <span className={m.chev}>{isOpen ? "▾" : "▸"}</span> : null}
              </button>
              {isOpen && nb.length > 0 ? (
                <ul className={m.neighbors}>
                  <li className={m.selfOpen}>
                    <Link href={`/d/${encodeURIComponent(n.id)}/`} onClick={() => track("graph_open", "/graph")}>
                      📄 이 문서 열기 →
                    </Link>
                  </li>
                  {nb.map((x) => (
                    <li key={x!.id}>
                      <Link href={`/d/${encodeURIComponent(x!.id)}/`} className={m.nb}
                        onClick={() => track("graph_open", "/graph")}>
                        <span className={m.dot} data-section={x!.section} aria-hidden />
                        <span className={m.nbTitle}>{x!.title}</span>
                        <span className={m.nbSection}>{SECTION_LABEL[x!.section] || x!.section}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className={m.empty}>검색 결과가 없어요.</li> : null}
      </ul>
    </div>
  );
}
