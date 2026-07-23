import { useState } from "react";
import GraphCanvas from "./GraphCanvas";
import GraphDocPanel from "./GraphDocPanel";
import MobileGraphList from "./mobile/MobileGraphList";
import type { GraphData } from "../lib/vault";
import { useMobileShell } from "../lib/useMobileShell";
import styles from "../styles/Graph.module.css";

/** 관계 그래프 본문(호롱 — 규정 찾기의 '그래프' 탭). pages/graph.tsx에서 추출, 동작 불변. */
export default function GraphView({ graph }: { graph: GraphData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const mobileList = useMobileShell();
  return (
    <>
      <div className={styles.head}>
        <p className={styles.lead}>
          규정 간 상호참조를 {mobileList ? "목록으로 봅니다. 문서를 펼치면 연결된 규정이 나오고, 눌러서 바로 이동해요."
            : "노드·링크로 봅니다. 노드를 클릭하면 옆에서 문서가 열리고, 그 상태로 그래프를 계속 조작할 수 있어요."}{" "}
          · <b>{graph.nodes.length}</b>개 문서 · <b>{graph.links.length}</b>개 연결
        </p>
        <div className={styles.legend}>
          <span><i style={{ background: "var(--accent-규정집)" }} />규정집</span>
          <span><i style={{ background: "var(--accent-가이드)" }} />연구행정 가이드</span>
          <span><i style={{ background: "var(--accent-용어집)" }} />용어집</span>
          <span><i style={{ background: "var(--accent-시스템)" }} />사내 시스템</span>
          <span><i style={{ background: "var(--accent-대외업무)" }} />대외업무</span>
          <span><i style={{ background: "var(--accent-상위법령)" }} />상위 법령</span>
        </div>
      </div>
      {mobileList ? (
        <MobileGraphList graph={graph} />
      ) : (
        <div className={styles.split}>
          <GraphCanvas graph={graph} onNodeSelect={setSelected} selectedId={selected} />
          {selected ? (
            <GraphDocPanel slug={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
          ) : null}
        </div>
      )}
    </>
  );
}
