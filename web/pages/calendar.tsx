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

// 업무 캘린더(docs/39·40, flag events_tab) — 연간 12개월 + 매월(상시) 업무를 한 화면에 자세히.
// 지금 KEI(/now)에서 분리해 전체를 시원하게 보여준다. 데이터는 볼트 seasonal.json(사람 큐레이션).

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function Item({ it }: { it: SeasonalItem }) {
  return (
    <li className={c.item}>
      <div className={c.itemHead}>
        <b className={c.itemTitle}>{it.title}</b>
        {it.구분 ? <span className={c.kindChip}>{it.구분}</span> : null}
        {it.시기 ? <span className={c.when}>{it.시기}</span> : null}
        {it.상태 === "예시" ? <span className={c.draft}>자료 확정 전</span> : null}
      </div>
      {it.desc ? <p className={c.desc}>{it.desc}</p> : null}
      {it.근거slug ? (
        <Link className={c.link} href={`/d/${encodeURIComponent(it.근거slug)}/`}>관련 문서 →</Link>
      ) : it.관련페이지 ? (
        <Link className={c.link} href={it.관련페이지}>바로 가보기 →</Link>
      ) : null}
    </li>
  );
}

export default function CalendarPage({ seasonal }: { seasonal: SeasonalItem[] }) {
  const on = useFlag("events_tab");
  const [realMonth, setRealMonth] = useState<number | null>(null);
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
  const MONTH_LABEL = ["", "1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

  return (
    <Layout>
      <Head><title>{`업무 캘린더 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>📅 업무 캘린더</h1>
        <p className={styles.lead}>
          매월 챙길 일과 달마다 반복되는 대외업무를 연간 한 화면에 모았어요. 3개년 반복이 확인된
          일정이며, 자세한 내용은 각 항목의 관련 문서에서 확인하세요.
        </p>
      </section>

      {/* 🔁 매월(상시) — 항상 펼친 상태로 상단에 */}
      {everyMonth.length > 0 ? (
        <section className={c.everyBlock} aria-label="매월 챙길 일">
          <h2 className={c.everyTitle}>🔁 매월 챙길 일 <span className={c.count}>{everyMonth.length}건 · 상시</span></h2>
          <ul className={c.everyGrid}>
            {everyMonth.map((it, i) => <Item key={i} it={it} />)}
          </ul>
        </section>
      ) : null}

      {/* 🗓 12개월 그리드 */}
      <div className={c.monthGrid}>
        {MONTHS.map((m) => {
          const items = seasonal.filter((s) => s.month === m);
          const isNow = realMonth === m;
          return (
            <section key={m} className={`${c.monthCard} ${isNow ? c.monthNow : ""}`} aria-label={`${MONTH_LABEL[m]} 업무`}>
              <h3 className={c.monthHead}>
                {MONTH_LABEL[m]}
                {isNow ? <span className={c.nowBadge}>이번 달</span> : null}
              </h3>
              {items.length === 0 ? (
                <p className={c.emptyMonth}>고유 일정 없음 (매월 항목은 상시 해당)</p>
              ) : (
                <ul className={c.monthList}>
                  {items.map((it, i) => <Item key={i} it={it} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <p className={c.foot}>
        ⓘ 대외업무 항목의 시기·건수는 대외업무관리시스템 3개년 관측 통계이며 규정상 의무·기한이 아니에요.
        정확한 마감·양식은 담당 부서와 원문을 확인하세요.
      </p>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { seasonal: loadSeasonal() } });
