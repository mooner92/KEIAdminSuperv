import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import { loadSeasonal, type SeasonalItem } from "../lib/vault";
import styles from "../styles/Home.module.css";
import c from "../styles/Calendar.module.css";

// 업무 캘린더(docs/39·40·43, flag events_tab) — "이번 달 중심 + 연간 그리드".
// 위계: ① 매월(상시)은 슬림 스트립으로 접고 ② 이번 달만 크게(설명 포함)
// ③ 나머지 12개월은 고정 4×3 달력 그리드(항목은 한 줄 링크만) — 달력다움은 균일한 12칸에서 나온다.
// 칩·설명·'관련 문서→' 반복은 소음이라 그리드에서 제거(제목 자체가 문서 링크).

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 항목 제목 = 문서 링크(있을 때). 그리드·스트립 공용 한 줄 렌더 */
function TitleLink({ it, className }: { it: SeasonalItem; className?: string }) {
  const body = (
    <>
      {it.title}
      {it.상태 === "예시" ? <sup className={c.draftMark} title="자료 확정 전">⁎</sup> : null}
    </>
  );
  if (it.근거slug)
    return <Link className={className} href={`/d/${encodeURIComponent(it.근거slug)}/?from=/calendar/`}>{body}</Link>;
  if (it.관련페이지) return <Link className={className} href={it.관련페이지}>{body}</Link>;
  return <span className={className}>{body}</span>;
}

export default function CalendarPage({ seasonal }: { seasonal: SeasonalItem[] }) {
  const on = useFlag("events_tab");
  const [realMonth, setRealMonth] = useState<number | null>(null);
  const [everyOpen, setEveryOpen] = useState(false);
  useEffect(() => {
    if (!on) return;
    setRealMonth(new Date().getMonth() + 1);
    track("calendar_view");
  }, [on]);

  if (!on) {
    return (
      <Layout>
        <Head><title>{`업무 캘린더 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <section className={styles.heroCompact}>
          <h1 className={styles.h1}>업무 캘린더</h1>
          <p className={styles.lead}>이 기능은 아직 준비 중이에요. 곧 만나요!</p>
        </section>
      </Layout>
    );
  }

  const everyMonth = seasonal.filter((s) => s.month === 0);
  const nowItems = realMonth ? seasonal.filter((s) => s.month === realMonth) : [];

  return (
    <Layout>
      <Head><title>{`업무 캘린더 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>📅 업무 캘린더</h1>
        <p className={styles.lead}>
          이번 달 챙길 일부터, 연간 반복 일정을 달력 한 화면에. 제목을 누르면 관련 문서로 이동해요.
        </p>
      </section>

      {/* 🔁 매월(상시) — 슬림 스트립(기본 접힘). 상시 항목은 달력 축이 아니라 배경 소음이라 접는다 */}
      {everyMonth.length > 0 ? (
        <section className={c.strip} aria-label="매월 챙길 일">
          <div className={c.stripHead}>
            <h2 className={c.stripTitle}>
              🔁 매월 챙길 일 <span className={c.count}>{everyMonth.length}건 · 상시</span>
            </h2>
            {!everyOpen ? (
              <p className={c.stripInline}>
                {everyMonth.map((it, i) => (
                  <span key={i}>
                    {i > 0 ? <span className={c.dot}> · </span> : null}
                    <TitleLink it={it} className={c.stripLink} />
                  </span>
                ))}
              </p>
            ) : null}
            <button className={c.stripToggle} onClick={() => setEveryOpen(!everyOpen)} aria-expanded={everyOpen}>
              {everyOpen ? "접기 ▴" : "펼치기 ▾"}
            </button>
          </div>
          {everyOpen ? (
            <ul className={c.stripList}>
              {everyMonth.map((it, i) => (
                <li key={i} className={c.stripItem}>
                  <TitleLink it={it} className={c.stripItemTitle} />
                  {it.시기 ? <span className={c.when}>{it.시기}</span> : null}
                  {it.desc ? <p className={c.desc}>{it.desc}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ⭐ 이번 달 — 유일하게 크게, 설명까지. '지금 뭐 챙기지'의 앵커 */}
      {realMonth ? (
        <section className={c.hero} aria-label="이번 달 하이라이트">
          <h3 className={c.heroHead}>
            {realMonth}월 <span className={c.nowBadge}>이번 달</span>
          </h3>
          {nowItems.length === 0 ? (
            <p className={c.heroEmpty}>이번 달 고유 일정은 없어요 — 위의 매월 챙길 일을 확인하세요.</p>
          ) : (
            <ul className={c.heroList}>
              {nowItems.map((it, i) => (
                <li key={i} className={c.heroItem}>
                  <span className={c.bullet} aria-hidden />
                  <div className={c.heroBody}>
                    <div className={c.heroTitleRow}>
                      <TitleLink it={it} className={c.heroTitle} />
                      {it.시기 ? <span className={c.when}>{it.시기}</span> : null}
                      {it.상태 === "예시" ? <span className={c.draft}>자료 확정 전</span> : null}
                    </div>
                    {it.desc ? <p className={c.desc}>{it.desc}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* 🗓 연간 그리드 — 고정 4×3, 균일 높이. 항목은 한 줄 제목 링크만 */}
      <div className={c.yearGrid}>
        {MONTHS.map((m) => {
          const items = seasonal.filter((s) => s.month === m);
          const isNow = realMonth === m;
          return (
            <section key={m} className={`${c.cell} ${isNow ? c.cellNow : ""}`} aria-label={`${m}월 업무`}>
              <h3 className={c.cellHead}>
                <span className={c.cellNum}>{m}</span>
                <span className={c.cellWol}>월</span>
                {isNow ? <span className={c.nowBadge}>이번 달</span> : null}
              </h3>
              {items.length === 0 ? (
                <p className={c.cellEmpty}>—</p>
              ) : (
                <ul className={c.cellList}>
                  {items.map((it, i) => (
                    <li key={i} className={c.cellItem}>
                      <TitleLink it={it} className={c.cellLink} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <p className={c.foot}>
        ⓘ 제목을 누르면 관련 문서로 이동해요 · ⁎ 자료 확정 전 · 대외업무 항목의 시기·건수는
        대외업무관리시스템 3개년 관측 통계이며 규정상 의무·기한이 아니에요. 정확한 마감·양식은
        담당 부서와 원문을 확인하세요.
      </p>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { seasonal: loadSeasonal() } });
