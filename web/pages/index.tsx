import type { GetStaticProps } from "next";
import Head from "next/head";
import Layout from "../components/Layout";
import GuideList from "../components/GuideList";
import { getAllDocs, type DocMeta } from "../lib/vault";
import styles from "../styles/Home.module.css";

export default function Home({ docs }: { docs: DocMeta[] }) {
  return (
    <Layout>
      <Head>
        <title>KEI 행정 가이드</title>
        <meta name="description" content="KEI 사내 규정·연구행정 가이드 (내부 전용)" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <section className={styles.hero}>
        <h1 className={styles.h1}>전직원 연구행정 가이드</h1>
        <p className={styles.lead}>
          사내 규정을 근거로 “이 업무 어떻게 처리하지?”를 빠르게. 검색하거나 분류로 둘러보세요.
        </p>
      </section>
      <GuideList docs={docs} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps<{ docs: DocMeta[] }> = async () => {
  return { props: { docs: getAllDocs() } };
};
