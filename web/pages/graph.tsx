import type { GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import GraphCanvas from "../components/GraphCanvas";
import { getGraph, type GraphData } from "../lib/vault";
import styles from "../styles/Graph.module.css";

export default function GraphPage({ graph }: { graph: GraphData }) {
  return (
    <Layout
      breadcrumb={
        <span>
          <Link href="/">전직원 연구행정 가이드</Link>
          <span className={styles.sep}>›</span>관계 그래프
        </span>
      }
    >
      <Head>
        <title>관계 그래프 · KEI 행정 가이드</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className={styles.head}>
        <h1 className={styles.h1}>관계 그래프</h1>
        <p className={styles.lead}>
          규정 간 상호참조를 노드·링크로 봅니다. 노드를 클릭하면 문서로 이동해요. ·{" "}
          <b>{graph.nodes.length}</b>개 문서 · <b>{graph.links.length}</b>개 연결
        </p>
        <div className={styles.legend}>
          <span>
            <i style={{ background: "#3182f6" }} />
            규정집
          </span>
          <span>
            <i style={{ background: "#03b26c" }} />
            연구행정 가이드
          </span>
          <span>
            <i style={{ background: "#fe9800" }} />
            용어집
          </span>
        </div>
      </div>
      <GraphCanvas graph={graph} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ graph: GraphData }> = async () => ({
  props: { graph: getGraph() },
});
