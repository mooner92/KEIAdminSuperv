import Head from "next/head";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import Landing, { type LandingCounts } from "../components/Landing";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { getAllDocs } from "../lib/vault";
import styles from "../styles/Home.module.css";

// 소개 페이지(docs/36, flag landing_page) — 스크롤 내러티브 + ScrollRail.
// 정적 export라 flag off여도 파일은 존재 → off면 '준비 중' 렌더(journey/changelog 관례).
// 수치는 빌드타임 볼트 실측치만(⛔ 지어내기 금지 — §3-5).
export default function AboutPage({ counts }: { counts: LandingCounts }) {
  const on = useFlag("landing_page");
  return (
    <Layout>{/* docs/47 §7: 슬라이드 통일 — full-bleed 불필요 */}
      <Head>
        <title>{`소개 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {on ? (
        <Landing variant="full" counts={counts} />
      ) : (
        <section className={styles.heroCompact}>
          <h1 className={styles.h1}>소개</h1>
          <p className={styles.lead}>이 페이지는 아직 준비 중이에요. 곧 만나요!</p>
        </section>
      )}
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => {
  const docs = getAllDocs();
  const counts: LandingCounts = {
    regs: docs.filter((d) => d.section === "규정집").length,
    guides: docs.filter((d) => d.section === "가이드").length,
    terms: docs.filter((d) => d.section === "용어집").length,
    reviewed: docs.filter((d) => d.reviewed === "검수완료").length,
  };
  return { props: { counts } };
};
