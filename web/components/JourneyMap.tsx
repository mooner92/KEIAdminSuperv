import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Journey, JourneyBasis, JourneyNode } from "../lib/vault";
import styles from "./JourneyMap.module.css";

/** 업무 한 장(docs/25) — 데스크톱: 레인(행위자)×단계 스윔레인 + SVG 엣지 오버레이,
 *  좁은 화면: 단계별 세로 스텝퍼. 노드 클릭 → 상세 패널(근거 조문 → DocDrawer).
 *  ⛔ 노드 데이터는 볼트 원문 대조 큐레이션(미검수 시작) — UI는 표시만, 값 생성 없음. */
export default function JourneyMap({
  journey,
  onOpenDoc,
}: {
  journey: Journey;
  onOpenDoc: (규정명: string, 조: string) => void;
}) {
  const [sel, setSel] = useState<JourneyNode | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [paths, setPaths] = useState<string[]>([]);
  const [svgSize, setSvgSize] = useState<[number, number]>([0, 0]);

  useEffect(() => setSel(null), [journey.id]);

  // 노드 실측 좌표로 엣지(SVG 베지어) 계산 — 리사이즈·여정 전환 대응
  useLayoutEffect(() => {
    const calc = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const g = grid.getBoundingClientRect();
      setSvgSize([grid.clientWidth, grid.clientHeight]); // 스크롤 강제 방지 — 표는 가용폭에 맞춤
      const pts: string[] = [];
      for (const [a, b] of journey.edges) {
        const ea = nodeRefs.current.get(a);
        const eb = nodeRefs.current.get(b);
        if (!ea || !eb) continue;
        const ra = ea.getBoundingClientRect();
        const rb = eb.getBoundingClientRect();
        const x1 = ra.right - g.left + grid.scrollLeft;
        const y1 = ra.top + ra.height / 2 - g.top + grid.scrollTop;
        const x2 = rb.left - g.left + grid.scrollLeft;
        const y2 = rb.top + rb.height / 2 - g.top + grid.scrollTop;
        const mx = (x1 + x2) / 2;
        pts.push(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 6} ${y2}`);
      }
      setPaths(pts);
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (gridRef.current) ro.observe(gridRef.current);
    window.addEventListener("resize", calc);
    return () => { ro.disconnect(); window.removeEventListener("resize", calc); };
  }, [journey]);

  const byCell = useMemo(() => {
    const m = new Map<string, JourneyNode[]>();
    for (const n of journey.nodes) {
      const k = `${n.lane}|${n.stage}`;
      m.set(k, [...(m.get(k) || []), n]);
    }
    return m;
  }, [journey]);

  const chips = (n: JourneyNode) => (
    <span className={styles.chips}>
      {n.erp ? <span className={styles.chipErp} title={n.erp.경로}>🖥 {n.erp.코드}</span> : null}
      {n.기한 ? <span className={styles.chipDue} title={n.기한.text}>⏱ 기한</span> : null}
      {n.전결 ? <span className={styles.chipAppr} title={n.전결.사다리}>✍ 전결</span> : null}
    </span>
  );

  const nodeBtn = (n: JourneyNode, withLane = false) => (
    <button
      key={n.id}
      ref={(el) => { if (el) nodeRefs.current.set(n.id, el); else nodeRefs.current.delete(n.id); }}
      className={`${styles.node} ${sel?.id === n.id ? styles.nodeOn : ""}`}
      onClick={() => setSel(sel?.id === n.id ? null : n)}
      data-node={n.id}
    >
      {withLane ? <span className={styles.laneBadge}>{n.lane}</span> : null}
      <span className={styles.nodeName}>{n.name}</span>
      {chips(n)}
    </button>
  );

  const basisBtn = (b: JourneyBasis, i: number) => (
    <button key={i} className={styles.basis} onClick={() => onOpenDoc(b.규정명, b.조)}>
      📄 {b.규정명}{b.조 ? ` ${b.조}` : ""}
    </button>
  );

  return (
    <div className={styles.wrap}>
      {/* 데스크톱: 스윔레인 */}
      <div className={styles.laneScroller}>
        <div
          ref={gridRef}
          className={styles.grid}
          style={{ gridTemplateColumns: `76px repeat(${journey.stages.length}, minmax(0, 1fr))` }}
        >
          <div className={styles.corner} />
          {journey.stages.map((s, i) => (
            <div key={s} className={styles.stageHead}><em>{i + 1}</em> {s}</div>
          ))}
          {journey.lanes.map((lane) => (
            <div key={lane} className={styles.laneRow}>
              <div className={styles.laneHead}>{lane}</div>
              {journey.stages.map((stage) => (
                <div key={stage} className={styles.cell}>
                  {(byCell.get(`${lane}|${stage}`) || []).map((n) => nodeBtn(n))}
                </div>
              ))}
            </div>
          ))}
          <svg className={styles.edges} width={svgSize[0]} height={svgSize[1]} aria-hidden>
            <defs>
              <marker id="jm-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" className={styles.arrowHead} />
              </marker>
            </defs>
            {paths.map((d, i) => (
              <path key={i} d={d} className={styles.edge} markerEnd="url(#jm-arrow)" />
            ))}
          </svg>
        </div>
      </div>

      {/* 좁은 화면: 단계별 세로 스텝퍼 (같은 데이터) */}
      <ol className={styles.stepper}>
        {journey.stages.map((stage, i) => (
          <li key={stage} className={styles.step}>
            <div className={styles.stepHead}><em>{i + 1}</em> {stage}</div>
            <div className={styles.stepNodes}>
              {journey.nodes.filter((n) => n.stage === stage).map((n) => nodeBtn(n, true))}
            </div>
          </li>
        ))}
      </ol>

      {/* 노드 상세 패널 */}
      {sel ? (
        <aside className={styles.detail} aria-label="단계 상세">
          <div className={styles.detailHead}>
            <b>{sel.name}</b>
            <span className={styles.laneBadge}>{sel.lane}</span>
            <button className={styles.close} onClick={() => setSel(null)} aria-label="닫기">✕</button>
          </div>
          <p className={styles.action}>{sel.action}</p>
          {sel.erp ? (
            <p className={styles.meta}>🖥 <b>{sel.erp.화면}</b> <code>{sel.erp.코드}</code><br />
              <span className={styles.path}>{sel.erp.경로}</span></p>
          ) : null}
          {sel.기한 ? (
            <p className={styles.meta}>⏱ {sel.기한.text}
              <button className={styles.basisInline} onClick={() => onOpenDoc(sel.기한!.근거.규정명, sel.기한!.근거.조)}>
                [{sel.기한.근거.규정명} {sel.기한.근거.조}]
              </button></p>
          ) : null}
          {sel.전결 ? (
            <p className={styles.meta}>✍ 전결: {sel.전결.사다리}
              <button className={styles.basisInline} onClick={() => onOpenDoc(sel.전결!.근거.규정명, sel.전결!.근거.조)}>
                [{sel.전결.근거.규정명}]
              </button></p>
          ) : null}
          <div className={styles.basisList}>{sel.근거.map(basisBtn)}</div>
        </aside>
      ) : null}
    </div>
  );
}
