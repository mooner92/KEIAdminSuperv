import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import { api } from "../lib/api";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import {
  loadChangelog, loadSeasonal, recentlyRevised, termPool,
  type ChangelogEntry, type SeasonalItem,
} from "../lib/vault";
import styles from "../styles/Home.module.css";
import n from "../styles/Now.module.css";

// 이벤트탭 "지금 KEI에서"(docs/35, flag events_tab) — 시기성 정보 한 장.
// 시즌 캘린더만 사람 큐레이션(볼트 _calendar/seasonal.json), 나머지는 전부 자동.

type Props = {
  seasonal: SeasonalItem[];
  revised: { slug: string; title: string; revised: string }[];
  notes: Pick<ChangelogEntry, "id" | "제목" | "날짜" | "분류">[];
  terms: { slug: string; title: string }[];
};

export default function NowPage({ seasonal, revised, notes, terms }: Props) {
  const on = useFlag("events_tab");
  const [month, setMonth] = useState<number | null>(null); // 이번 달 — null = 클라이언트 미확정(SSG 안전)
  const [trending, setTrending] = useState<{ k: string; n: number }[] | null>(null);
  const [trendErr, setTrendErr] = useState<number | null>(null); // HTTP status(401=로그인 필요) | 0=기타

  useEffect(() => { setMonth(new Date().getMonth() + 1); }, []);
  useEffect(() => {
    if (!on) return;
    track("now_view"); // flag off면 미발화(서버도 무시하지만 전송 자체를 안 함)
    api.trending(7).then((r) => setTrending(r.keywords))
      .catch((e) => setTrendErr(typeof e?.status === "number" ? e.status : 0));
  }, [on]);

  // 오늘의 용어 — 날짜 시드로 결정적 선택(같은 날 = 같은 용어, 정적 export라 클라이언트 계산).
  const todayTerm = useMemo(() => {
    if (!terms.length || month === null) return null;
    const d = new Date();
    const seed = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
    return terms[seed % terms.length];
  }, [terms, month]);

  // 이번 달 고유 항목 + 매월(상시, month 0). 상세·다른 달은 /calendar로 이전(docs/40).
  const monthItems = useMemo(
    () => (month === null ? [] : seasonal.filter((s) => s.month === month)),
    [seasonal, month]
  );
  const everyMonth = useMemo(() => seasonal.filter((s) => s.month === 0), [seasonal]);
  const maxTrend = trending?.length ? Math.max(...trending.map((t) => t.n)) : 1;

  if (!on) {
    return (
      <Layout>
        <Head><title>{`지금 KEI에서 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <section className={styles.heroCompact}>
          <h1 className={styles.h1}>지금 KEI에서</h1>
          <p className={styles.lead}>이 기능은 아직 준비 중이에요. 곧 만나요!</p>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>{`지금 KEI에서 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>지금 KEI에서</h1>
        <p className={styles.lead}>이번 달 챙길 일과 요즘 흐름을 한 장에 모았어요.</p>
      </section>

      <div className={n.grid}>
        {/* 🗓 이번 달 챙길 일 — 컴팩트 요약(전체는 /calendar). 매월·다른 달·상세는 캘린더 페이지로 이전 */}
        <section className={n.card} aria-label="이번 달 챙길 일">
          <h2 className={n.h2}>🗓 {month === null ? "이번 달" : `${month}월`} 챙길 일</h2>
          {monthItems.length === 0 && everyMonth.length === 0 ? (
            <p className={n.muted}>등록된 일정이 없어요.</p>
          ) : (
            <ul className={n.calList}>
              {(monthItems.length > 0 ? monthItems : everyMonth).slice(0, 4).map((it, i) => (
                <li key={i}>
                  <div className={n.calHead}>
                    <b>{it.title}</b>
                    {it.구분 ? <span className={n.kindChip}>{it.구분}</span> : null}
                    {it.상태 === "예시" ? <span className={n.draft}>자료 확정 전</span> : null}
                  </div>
                  {it.desc ? <p className={n.calDesc}>{it.desc}</p> : null}
                </li>
              ))}
            </ul>
          )}
          <Link className={n.calMore} href="/calendar/">📅 업무 캘린더 전체 보기 →</Link>
        </section>

        {/* 📈 요즘 많이 찾는 키워드 */}
        <section className={n.card} aria-label="요즘 많이 찾는 키워드">
          <h2 className={n.h2}>📈 요즘 많이 찾는 키워드 <span className={n.muted}>(최근 7일)</span></h2>
          {trendErr !== null ? (
            <p className={n.muted}>{trendErr === 401 ? "로그인하면 볼 수 있어요." : "지금은 키워드를 불러올 수 없어요."}</p>
          ) : trending === null ? (
            <p className={n.muted}>불러오는 중…</p>
          ) : trending.length === 0 ? (
            <p className={n.muted}>아직 집계된 키워드가 없어요.</p>
          ) : (
            <ul className={n.trendList}>
              {trending.slice(0, 5).map((t) => (
                <li key={t.k}>
                  <Link href={`/?q=${encodeURIComponent(t.k + " ")}`} className={n.trendLabel}
                    onClick={() => track("trending_click", "/now")}>
                    {t.k}
                  </Link>
                  <span className={n.trendBarWrap}>
                    <span className={n.trendBar} style={{ width: `${Math.max(8, (t.n / maxTrend) * 100)}%` }} />
                  </span>
                  <span className={n.trendN}>{t.n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 📜 최근 개정된 규정 */}
        <section className={n.card} aria-label="최근 개정된 규정">
          <h2 className={n.h2}>📜 최근 개정된 규정</h2>
          <ul className={n.plainList}>
            {revised.map((d) => (
              <li key={d.slug}>
                <Link href={`/d/${encodeURIComponent(d.slug)}/`}>{d.title}</Link>
                <span className={n.muted}> · {d.revised.replace(/-/g, ".")}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 🆕 새로워진 점 */}
        <section className={n.card} aria-label="새로워진 점">
          <h2 className={n.h2}>🆕 새로워진 점</h2>
          <ul className={n.plainList}>
            {notes.map((e) => (
              <li key={e.id}>
                <Link href={`/changelog/#${e.id}`}>{e.제목}</Link>
                <span className={n.muted}> · {e.날짜.replace(/-/g, ".")}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 📖 오늘의 용어 */}
        <section className={n.card} aria-label="오늘의 용어">
          <h2 className={n.h2}>📖 오늘의 용어</h2>
          {todayTerm ? (
            <p className={n.termBody}>
              <Link href={`/d/${encodeURIComponent(todayTerm.slug)}/`} className={n.termLink}>
                {todayTerm.title}
              </Link>
              <span className={n.muted}> — 눌러서 뜻을 확인해 보세요. 내일은 다른 용어가 나와요.</span>
            </p>
          ) : (
            <p className={n.muted}>용어집이 비어 있어요.</p>
          )}
        </section>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({
  props: {
    seasonal: loadSeasonal(),
    revised: recentlyRevised(5),
    notes: loadChangelog().slice(0, 3).map(({ id, 제목, 날짜, 분류 }) => ({ id, 제목, 날짜, 분류 })),
    terms: termPool(),
  },
});
