import { useEffect, useState } from "react";
import type { GetStaticProps } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { SITE_NAME } from "../lib/site";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import Explorer from "../components/Explorer";
import FormsView from "../components/FormsView";
import GraphView from "../components/GraphView";
import { getAllDocs, getGraph, loadForms, type DocMeta, type FormEntry, type GraphData } from "../lib/vault";
import s from "../styles/BrowseTabs.module.css";

// 호롱 IA(design-revolution, 03 규정 찾기): 문서·서식·그래프를 한 화면의 세그먼트 탭으로 통합.
// 기존 /forms·/graph 라우트는 해당 탭으로 리다이렉트(딥링크 보존) — 기능·로직은 각 View 컴포넌트에 불변 이전.
type Tab = "docs" | "forms" | "graph";
const TABS: { k: Tab; label: string }[] = [
  { k: "docs", label: "문서" },
  { k: "forms", label: "서식" },
  { k: "graph", label: "그래프" },
];
const LEADS: Record<Tab, string> = {
  docs: "왼쪽에서 구분·분류·검수상태로 좁히고, 문서를 누르면 오른쪽에서 바로 펼쳐 읽을 수 있어요.",
  forms: "규정 별지·연구관리양식·법령 별표를 한곳에서 검색하고 바로 열어보세요.",
  graph: "문서 간 상호참조를 노드·링크로 봅니다. 노드를 클릭하면 문서가 열려요.",
};

export default function Browse({ docs, forms, graph }: { docs: DocMeta[]; forms: FormEntry[]; graph: GraphData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("docs");
  useEffect(() => {
    const q = router.query.tab;
    if (q === "forms" || q === "graph" || q === "docs") setTab(q);
  }, [router.query.tab]);
  const go = (t: Tab) => {
    setTab(t);
    router.replace({ pathname: "/browse/", query: t === "docs" ? {} : { tab: t } }, undefined, { shallow: true });
  };
  return (
    <Layout fill>
      <Head>
        <title>{`문서 찾기 · ${SITE_NAME}`}</title>
        <meta name="description" content="KEI 행정 문서·서식·관계 그래프 (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <PageHero title="문서 찾기" lead={LEADS[tab]} />
      {/* 세그먼트 컨트롤 — 회색 트랙 + 흰 알약 썸(호롱 03) */}
      <div className={s.segWrap}>
        <div className={s.segTrack} role="tablist" aria-label="문서 찾기 보기">
          {TABS.map((t) => (
            <button key={t.k} role="tab" aria-selected={tab === t.k}
              className={`${s.segBtn} ${tab === t.k ? s.segOn : ""}`}
              onClick={() => go(t.k)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "docs" ? <Explorer docs={docs} /> : null}
      {tab === "forms" ? <div className={s.tabGraph}><FormsView forms={forms} /></div> : null}
      {tab === "graph" ? <div className={s.tabGraph}><GraphView graph={graph} /></div> : null}
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => ({
  props: { docs: getAllDocs(), forms: loadForms(), graph: getGraph() },
});
