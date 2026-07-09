import type { GetStaticProps } from "next";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Layout from "../components/Layout";
import Assistant from "../components/Assistant";
import { getAllDocs, type DocMeta } from "../lib/vault";

export default function Home({ docs }: { docs: DocMeta[] }) {
  return (
    <Layout>
      <Head>
        <title>{SITE_NAME} — 질문하기</title>
        <meta name="description" content="KEI 사내 규정 기반 행정 LLM (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Assistant docs={docs} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[] }> = async () => {
  return { props: { docs: getAllDocs() } };
};
