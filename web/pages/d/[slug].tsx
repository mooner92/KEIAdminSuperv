import type { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import Link from "next/link";
import Layout from "../../components/Layout";
import Markdown from "../../components/Markdown";
import { getAllDocs, getDoc, getBacklinks, type Doc, type DocMeta } from "../../lib/vault";
import styles from "../../styles/Doc.module.css";

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "ERP 시스템",
};

export default function DocPage({ doc, backlinks }: { doc: Doc; backlinks: DocMeta[] }) {
  return (
    <Layout
      breadcrumb={
        <span className={styles.crumb}>
          <Link href="/">전직원 연구행정 가이드</Link>
          <span className={styles.sep}>›</span>
          <span>{SECTION_LABEL[doc.section]}</span>
          <span className={styles.sep}>›</span>
          <span className={styles.crumbCur}>{doc.title}</span>
        </span>
      }
    >
      <Head>
        <title>{doc.title} · KEI 행정 가이드</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <article className={styles.article}>
        <header className={styles.head}>
          <div className={styles.tags}>
            <span className={styles.chip} data-section={doc.section}>
              {SECTION_LABEL[doc.section]}
            </span>
            {doc.regNo ? <span className={styles.tag}>규정번호 {doc.regNo}</span> : null}
            {doc.category ? <span className={styles.tag}>{doc.category}</span> : null}
            {doc.revised ? <span className={styles.tag}>개정 {doc.revised}</span> : null}
            <span
              className={
                doc.reviewed === "검수완료" ? `${styles.badge} ${styles.badgeOk}` : styles.badge
              }
            >
              {doc.reviewed || "미검수"}
            </span>
          </div>
          <h1 className={styles.h1}>{doc.title}</h1>
        </header>

        <Markdown source={doc.body} />
      </article>

      {backlinks.length > 0 ? (
        <aside className={styles.backlinks}>
          <h2 className={styles.blTitle}>이 문서를 인용한 문서 · {backlinks.length}</h2>
          <ul className={styles.blList}>
            {backlinks.map((b) => (
              <li key={b.slug}>
                <Link href={`/d/${b.slug}/`}>{b.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      <div className={styles.foot}>
        <Link href="/" className={styles.back}>
          ← 목록으로
        </Link>
      </div>
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllDocs().map((d) => ({ params: { slug: d.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = String(params?.slug);
  const doc = getDoc(slug);
  if (!doc) return { notFound: true };
  return { props: { doc, backlinks: getBacklinks(slug) } };
};
