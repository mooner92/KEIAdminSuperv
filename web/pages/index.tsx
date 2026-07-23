import type { GetStaticProps } from "next";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Layout from "../components/Layout";
import Assistant from "../components/Assistant";
import { getAllDocs, loadJourneys, type DocMeta } from "../lib/vault";
import type { LandingCounts } from "../components/Landing";

// 상황 시작 칩(docs/38 §A)용 여정 최소 정보 — 빌드타임 실존 여정만 노출(하드코딩 드리프트 방지)
import type { JourneyChip } from "../lib/api";
export type { JourneyChip }; // 하위 호환 re-export(외부 참조 대비)

export default function Home({ docs, counts, journeys }: { docs: DocMeta[]; counts: LandingCounts; journeys: JourneyChip[] }) {
  return (
    <Layout>
      <Head>
        <title>{SITE_NAME} — 질문하기</title>
        <meta name="description" content="KEI 사내 규정 기반 행정 LLM (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Assistant docs={docs} counts={counts} journeys={journeys} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[]; counts: LandingCounts; journeys: JourneyChip[] }> = async () => {
  const docs = getAllDocs();
  const journeys: JourneyChip[] = loadJourneys().map((j) => ({ id: j.id, title: j.title, emoji: j.emoji }));
  const counts: LandingCounts = {
    regs: docs.filter((d) => d.section === "규정집").length,
    guides: docs.filter((d) => d.section === "가이드").length,
    terms: docs.filter((d) => d.section === "용어집").length,
    reviewed: docs.filter((d) => d.reviewed === "검수완료").length,
  };
  return { props: { docs, counts, journeys } };
};
