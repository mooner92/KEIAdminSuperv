import type { GetStaticProps } from "next";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Layout from "../components/Layout";
import Assistant from "../components/Assistant";
import { getAllDocs, type DocMeta } from "../lib/vault";
import type { LandingCounts } from "../components/Landing";

export default function Home({ docs, counts }: { docs: DocMeta[]; counts: LandingCounts }) {
  return (
    <Layout>
      <Head>
        <title>{SITE_NAME} — 질문하기</title>
        <meta name="description" content="KEI 사내 규정 기반 행정 LLM (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Assistant docs={docs} counts={counts} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[]; counts: LandingCounts }> = async () => {
  const docs = getAllDocs();
  const counts: LandingCounts = {
    regs: docs.filter((d) => d.section === "규정집").length,
    guides: docs.filter((d) => d.section === "가이드").length,
    terms: docs.filter((d) => d.section === "용어집").length,
    reviewed: docs.filter((d) => d.reviewed === "검수완료").length,
  };
  return { props: { docs, counts } };
};
