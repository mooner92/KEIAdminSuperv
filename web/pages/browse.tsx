import type { GetStaticProps } from "next";
import Head from "next/head";
import { SITE_NAME } from "../lib/site";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import Explorer from "../components/Explorer";
import { getAllDocs, type DocMeta } from "../lib/vault";

export default function Browse({ docs }: { docs: DocMeta[] }) {
  return (
    <Layout fill>
      <Head>
        <title>{`규정 둘러보기 · ${SITE_NAME}`}</title>
        <meta name="description" content="KEI 사내 규정·연구행정 가이드 둘러보기 (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <PageHero title="규정 둘러보기"
        lead="왼쪽에서 구분·분류·검수상태로 좁히고, 문서를 누르면 오른쪽에서 바로 펼쳐 읽을 수 있어요." />
      <Explorer docs={docs} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[] }> = async () => {
  return { props: { docs: getAllDocs() } };
};
