import { useState } from "react";
import type { GetStaticProps } from "next";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Link from "next/link";
import Layout from "../components/Layout";
import GraphCanvas from "../components/GraphCanvas";
import GraphDocPanel from "../components/GraphDocPanel";
import MobileGraphList from "../components/mobile/MobileGraphList";
import { getGraph, type GraphData } from "../lib/vault";
import { useMobileShell } from "../lib/useMobileShell";
import styles from "../styles/Graph.module.css";

export default function GraphPage({ graph }: { graph: GraphData }) {
  const splitOn = true; // graph_split 졸업(v1 ⑦, 2026-07-09): 검증 완료 → 분할 뷰 상시 적용
  const [selected, setSelected] = useState<string | null>(null);
  // 모바일 셸에선 캔버스(무거움) 대신 리스트 간소 뷰 — react-force-graph를 아예 로드 안 함(docs/54 v2)
  const mobileList = useMobileShell();
  return (
    <Layout
      fill
      breadcrumb={
        <span>
          <Link href="/">{SITE_NAME}</Link>
          <span className={styles.sep}>›</span>관계 그래프
        </span>
      }
    >
      <Head>
        <title>{`관계 그래프 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className={styles.head}>
        <h1 className={styles.h1}>관계 그래프</h1>
        <p className={styles.lead}>
          규정 간 상호참조를 {mobileList ? "목록으로 봅니다. 문서를 펼치면 연결된 규정이 나오고, 눌러서 바로 이동해요."
            : "노드·링크로 봅니다. 노드를 클릭하면 옆에서 문서가 열리고, 그 상태로 그래프를 계속 조작할 수 있어요."}{" "}
          · <b>{graph.nodes.length}</b>개 문서 · <b>{graph.links.length}</b>개 연결
        </p>
        <div className={styles.legend}>
          <span>
            <i style={{ background: "var(--accent-규정집)" }} />
            규정집
          </span>
          <span>
            <i style={{ background: "var(--accent-가이드)" }} />
            연구행정 가이드
          </span>
          <span>
            <i style={{ background: "var(--accent-용어집)" }} />
            용어집
          </span>
          <span>
            <i style={{ background: "var(--accent-시스템)" }} />
            사내 시스템
          </span>
          <span>
            <i style={{ background: "var(--accent-대외업무)" }} />
            대외업무
          </span>
        </div>
      </div>
      {mobileList ? (
        <MobileGraphList graph={graph} />
      ) : splitOn ? (
        <div className={styles.split}>
          <GraphCanvas graph={graph} onNodeSelect={setSelected} selectedId={selected} />
          {selected ? (
            <GraphDocPanel slug={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
          ) : null}
        </div>
      ) : (
        <GraphCanvas graph={graph} />
      )}
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ graph: GraphData }> = async () => ({
  props: { graph: getGraph() },
});
