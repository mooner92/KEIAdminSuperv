import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import Markdown from "../components/Markdown";
import { useFlag } from "../lib/flags";
import { track } from "../lib/track";
import { SITE_NAME } from "../lib/site";
import { loadChangelog, type ChangelogEntry } from "../lib/vault";
import styles from "../styles/Home.module.css";
import c from "../styles/Changelog.module.css";

// '새로워진 점'(docs/32) — 업데이트 노트 목록. 노트 원문은 볼트(90_관리/_changelog)에만 있고
// 빌드타임에 정적으로 굽는다. ⛔ 노트에 규정 값 금지(changelog_lint가 강제).
const CATS = ["전체", "신규", "개선", "수정", "데이터"] as const;
const CAT_EMOJI: Record<string, string> = { 신규: "✨", 개선: "🔧", 수정: "🩹", 데이터: "📚" };

export default function ChangelogPage({ entries }: { entries: ChangelogEntry[] }) {
  const on = useFlag("changelog"); // docs/32 §5ⓓ: off면 페이지 본문도 미노출(journey/approval 관례)
  const [cat, setCat] = useState<(typeof CATS)[number]>("전체");
  useEffect(() => { if (on) track("changelog_view"); }, [on]);
  const shown = cat === "전체" ? entries : entries.filter((e) => e.분류 === cat);
  if (!on) {
    return (
      <Layout>
        <Head><title>{`새로워진 점 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <section className={styles.heroCompact}>
          <h1 className={styles.h1}>새로워진 점</h1>
          <p className={styles.lead}>이 기능은 아직 준비 중이에요. 곧 만나요!</p>
        </section>
      </Layout>
    );
  }
  return (
    <Layout>
      <Head><title>{`새로워진 점 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>새로워진 점</h1>
        <p className={styles.lead}>{SITE_NAME}는 계속 좋아지고 있어요 — 최근 업데이트를 모았습니다.</p>
      </section>

      <div className={c.filters} role="tablist" aria-label="분류 필터">
        {CATS.map((k) => (
          <button key={k} role="tab" aria-selected={cat === k}
            className={`${c.filterChip} ${cat === k ? c.filterOn : ""}`} onClick={() => setCat(k)}>
            {k}
          </button>
        ))}
      </div>

      <div className={c.list}>
        {shown.map((e) => (
          <article key={e.id} className={c.card} id={e.id}>
            <header className={c.cardHead}>
              <span className={c.cat} data-cat={e.분류}>{CAT_EMOJI[e.분류] || "•"} {e.분류}</span>
              <h2 className={c.cardTitle}>{e.제목}</h2>
              <time className={c.date}>{e.날짜.replace(/-/g, ".")}</time>
            </header>
            <div className={c.cardBody}>
              <Markdown source={e.body} />
              {e.관련페이지 ? (
                <Link href={e.관련페이지} className={c.goLink}>바로 가보기 →</Link>
              ) : null}
            </div>
          </article>
        ))}
        {shown.length === 0 ? <p className={c.empty}>이 분류의 업데이트가 아직 없어요.</p> : null}
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({
  props: { entries: loadChangelog() },
});
