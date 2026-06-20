import type { GetStaticProps } from "next";
import Head from "next/head";
import Layout from "../components/Layout";
import Explorer from "../components/Explorer";
import { getAllDocs, type DocMeta } from "../lib/vault";
import styles from "../styles/Home.module.css";

export default function Browse({ docs }: { docs: DocMeta[] }) {
  return (
    <Layout fill>
      <Head>
        <title>규정 둘러보기 · KEI 행정 가이드</title>
        <meta name="description" content="KEI 사내 규정·연구행정 가이드 둘러보기 (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>규정 둘러보기</h1>
        <p className={styles.lead}>
          왼쪽에서 구분·분류·검수상태로 좁히고, 문서를 누르면 오른쪽에서 바로 펼쳐 읽을 수 있어요.
        </p>
      </section>
      <Explorer docs={docs} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[] }> = async () => {
  return { props: { docs: getAllDocs() } };
};
