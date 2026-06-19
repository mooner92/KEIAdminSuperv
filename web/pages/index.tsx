import type { GetStaticProps } from "next";
import Head from "next/head";
import Layout from "../components/Layout";
import Assistant from "../components/Assistant";
import { getAllDocs, type DocMeta } from "../lib/vault";

export default function Home({ docs }: { docs: DocMeta[] }) {
  return (
    <Layout>
      <Head>
        <title>KEI 행정 비서</title>
        <meta name="description" content="KEI 사내 규정 기반 행정 비서 (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Assistant docs={docs} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[] }> = async () => {
  return { props: { docs: getAllDocs() } };
};
