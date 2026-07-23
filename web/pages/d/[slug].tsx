import type { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SITE_NAME } from "../../lib/site";
import Link from "next/link";
import Layout from "../../components/Layout";
import Markdown from "../../components/common/Markdown";
import ReaderGlass from "../../components/reader/ReaderGlass";
import ReaderGlassToggle from "../../components/reader/ReaderGlassToggle";
import { getAllDocs, getDoc, getBacklinks, type Doc, type DocMeta } from "../../lib/vault";
import styles from "../../styles/Doc.module.css";

// '목록으로' 복귀 대상. 과거엔 `/`(질문하기/LLM)로 하드코딩돼, 캘린더·둘러보기 등에서 문서를 열고
// 목록으로 누르면 챗봇으로 튕기던 버그가 있었다. 기본은 실제 문서 목록(/browse), 진입 화면을
// `?from=`으로 알려주면 그 화면으로 되돌린다(화이트리스트만 허용 — 오픈 리다이렉트 방지).
const FROM_MAP: Record<string, string> = {
  "/browse/": "목록으로",
  "/calendar/": "업무 캘린더로",
  "/now/": "추가 기능으로",
  "/journey/": "업무 한 장으로",
  "/graph/": "관계 그래프로",
  "/forms/": "서식 찾기로",
  "/changelog/": "새로워진 점으로",
};

function BackToList() {
  const router = useRouter();
  const [href, setHref] = useState("/browse/");
  const [label, setLabel] = useState("목록으로");
  useEffect(() => {
    const from = typeof router.query.from === "string" ? router.query.from : "";
    if (from && FROM_MAP[from]) {
      setHref(from);
      setLabel(FROM_MAP[from]);
    }
  }, [router.query.from]);
  return (
    <Link href={href} className={styles.back}>
      ← {label}
    </Link>
  );
}

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "사내 시스템",
  대외업무: "대외업무",
};

export default function DocPage({ doc, backlinks }: { doc: Doc; backlinks: DocMeta[] }) {
  const articleRef = useRef<HTMLElement>(null);
  const [glass, setGlass] = useState(false);
  return (
    <Layout
      breadcrumb={
        <span className={styles.crumb}>
          <Link href="/">{SITE_NAME}</Link>
          <span className={styles.sep}>›</span>
          <span>{SECTION_LABEL[doc.section]}</span>
          <span className={styles.sep}>›</span>
          <span className={styles.crumbCur}>{doc.title}</span>
        </span>
      }
    >
      <Head>
        <title>{`${doc.title} · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {/* 돋보기 토글 — 우측 최상단 sticky(스크롤해도 따라옴). 모바일 탭바(하단)와 겹치지 않음 */}
      <div className={styles.glassBar}>
        <ReaderGlassToggle on={glass} onToggle={() => setGlass((v) => !v)} />
      </div>
      {glass ? <ReaderGlass targetRef={articleRef} onClose={() => setGlass(false)} /> : null}
      <article ref={articleRef} className={styles.article}>
        <header className={styles.head}>
          <div className={styles.tags}>
            <span className={styles.chip} data-section={doc.section}>
              {SECTION_LABEL[doc.section]}
            </span>
            {doc.regNo ? <span className={styles.tag}>규정번호 {doc.regNo}</span> : null}
            {doc.type === "uplaw" ? (
              <span className={styles.tag} title="KEI 사내 규정이 아닌 상위 규범(법령·연구회 공통 규정)">
                ⚖ 상위 법령 · 적용강도 {doc.strength || "준거"}
              </span>
            ) : null}
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

        {doc.type === "uplaw" ? (
          <p className={styles.uplawNote}>
            ⚖ 이 문서는 <b>KEI 사내 규정이 아닌 상위 규범</b>(국가 법령·경제·인문사회연구회 공통
            규정)입니다. 사내 세부 기준은 사내 규정이 우선하며, 적용 여부는 담당 부서 확인이
            필요합니다. <i>(원문 출처: {doc.category || "법제처/연구회"})</i>
          </p>
        ) : null}
        <Markdown source={doc.body} selfSlug={doc.slug} />
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
        <BackToList />
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
