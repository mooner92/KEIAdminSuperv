import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import { SITE_NAME } from "../lib/site";
import styles from "../styles/Home.module.css";

// v1 ⑩(S5-#13): 커스텀 404 — 한국어 안내 + 복귀 경로
export default function NotFound() {
  return (
    <Layout>
      <Head>
        <title>{`페이지를 찾을 수 없어요 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <section className={styles.heroCompact} style={{ textAlign: "center", padding: "64px 0" }}>
        <div style={{ fontSize: 40 }}>🧭</div>
        <h1 className={styles.h1}>페이지를 찾을 수 없어요</h1>
        <p className={styles.lead}>
          주소가 바뀌었거나 삭제된 문서일 수 있어요. 규정 이름이 기억나면 둘러보기에서 검색해 보세요.
        </p>
        <p style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
          <Link href="/">💬 질문하러 가기</Link>
          <Link href="/browse/">📚 문서 둘러보기</Link>
        </p>
      </section>
    </Layout>
  );
}
