import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import q from "../styles/Quality.module.css";

// 품질 게시판(docs/58 §5, flag quality_board) — 매일 자가평가 결과 공개.
// 데이터는 정적 export가 아니라 런타임 fetch(server.js가 web/public/quality 직서빙, 매일 갱신).
// ⛔ 자동 생성 문항·자동 채점(검수 전) — 개별 답변 보증 아님. 합성 문항만(실사용자 질문 미포함).

type Stat = { 정답?: number; 표본?: number; 정답률?: number | null };
type Item = {
  id: string; 질문: string; 유형: string; 정량여부?: boolean; 주제?: string[]; 분류?: string;
  판정: string; 증거?: string; 원인?: string | null; 답변?: string; 근거문장?: string;
  출처?: { 규정명: string; 조: string } | null; 회귀?: boolean;
};
type Daily = {
  date: string; 정답률: number; 집계: Record<string, number>;
  약점지도: { 주제: Record<string, Stat>; 유형: Record<string, Stat>; 정량정성: Record<string, Stat> };
  원인: Record<string, number>; 문항: Item[];
};
type Idx = { days: { date: string; 정답률: number; 집계: Record<string, number> }[] };

const VERDICT: Record<string, { icon: string; cls: string; label: string }> = {
  정답: { icon: "✅", cls: "vOk", label: "정답" },
  오답: { icon: "❌", cls: "vBad", label: "오답" },
  검토필요: { icon: "🔍", cls: "vRev", label: "검토필요" },
  판정불가: { icon: "—", cls: "vNa", label: "판정불가" },
  폐기: { icon: "🗑", cls: "vNa", label: "출제 폐기" },
};
const CAUSE: Record<string, string> = {
  검색실패: "🔎 검색 실패", 생성환각: "🌀 생성 환각", 원문결함: "📄 원문 결함", 채점오류: "⚖ 채점 오류",
};

function accColor(a: number | null | undefined): string {
  if (a == null) return "var(--color-text-disabled)";
  if (a >= 90) return "var(--color-success)";
  if (a >= 75) return "var(--color-text)";
  if (a >= 60) return "var(--color-warning)";
  return "var(--color-danger)";
}

export default function QualityPage() {
  const on = useFlag("quality_board");
  const [idx, setIdx] = useState<Idx | null>(null);
  const [day, setDay] = useState<Daily | null>(null);
  const [err, setErr] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null); // 펼친 문항 id
  const [filter, setFilter] = useState<string>("전체"); // 판정 필터

  useEffect(() => {
    if (!on) return;
    fetch("/quality/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no-index"))))
      .then((i: Idx) => {
        setIdx(i);
        const latest = i.days[i.days.length - 1]?.date;
        if (!latest) throw new Error("empty");
        return fetch(`/quality/daily/${latest}.json`).then((r) => r.json());
      })
      .then((d: Daily) => setDay(d))
      .catch(() => setErr("아직 평가 데이터가 없어요. 매일 새벽 자동 평가 후 채워집니다."));
  }, [on]);

  const items = useMemo(
    () => (day ? (filter === "전체" ? day.문항 : day.문항.filter((i) => i.판정 === filter)) : []),
    [day, filter]
  );
  const trend = idx?.days.slice(-30) ?? [];
  const maxAcc = 100;

  if (!on) {
    return (
      <Layout>
        <Head><title>{`품질 게시판 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="품질 게시판" lead="이 기능은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>{`품질 게시판 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="품질 게시판"
        lead={<>매일 새벽, 규정에서 만든 문항으로 챗봇을 스스로 시험하고 원문과 대조해 채점해요.
          ⚠ <b>자동 생성·자동 채점(검수 전)</b>이라 개별 답변의 보증이 아니라 서비스 품질의 지표입니다.</>} />

      {err ? <p className={q.empty}>{err}</p> : !day ? <p className={q.empty}>불러오는 중…</p> : (
        <>
          {/* 오늘의 정답률 */}
          <section className={q.heroRow}>
            <div className={q.scoreCard}>
              <div className={q.scoreLabel}>오늘의 정답률 · {day.date}</div>
              <div className={q.score} style={{ color: accColor(day.정답률) }}>{day.정답률}%</div>
              <div className={q.scoreSub}>
                {Object.entries(day.집계).map(([k, v]) => {
                  const V = VERDICT[k];
                  return <span key={k} className={q.tally}>{V?.icon} {V?.label ?? k} {v}</span>;
                })}
              </div>
            </div>
            {/* 30일 추이 */}
            <div className={q.trendCard}>
              <div className={q.cardTitle}>최근 {trend.length}일 정답률</div>
              <div className={q.trend}>
                {trend.map((d) => (
                  <div key={d.date} className={q.bar} title={`${d.date} · ${d.정답률}%`}>
                    <div className={q.barFill} style={{ height: `${(d.정답률 / maxAcc) * 100}%`, background: accColor(d.정답률) }} />
                  </div>
                ))}
                {trend.length === 0 ? <span className={q.mutedSm}>추이 데이터가 쌓이는 중</span> : null}
              </div>
            </div>
          </section>

          {/* 약점 지도 */}
          <section className={q.card}>
            <div className={q.cardTitle}>약점 지도 <span className={q.mutedSm}>(정답률 · 표본 5건 미만은 회색)</span></div>
            <div className={q.mapGrid}>
              {Object.entries(day.약점지도.주제)
                .filter(([, s]) => (s.표본 ?? 0) > 0)
                .sort((a, b) => (a[1].정답률 ?? 101) - (b[1].정답률 ?? 101))
                .map(([topic, s]) => (
                  <div key={topic} className={q.mapCell}
                    style={{ opacity: (s.표본 ?? 0) < 5 ? 0.5 : 1 }}>
                    <span className={q.mapTopic}>{topic}</span>
                    <span className={q.mapAcc} style={{ color: accColor(s.정답률) }}>
                      {s.정답률 == null ? "—" : `${s.정답률}%`}
                    </span>
                    <span className={q.mapN}>{s.표본}문</span>
                  </div>
                ))}
            </div>
            <div className={q.miniBars}>
              {(["정량", "정성"] as const).map((k) => {
                const s = day.약점지도.정량정성[k];
                return s ? (
                  <span key={k} className={q.miniBar}>
                    <b>{k === "정량" ? "수치형" : "서술형"}</b> {s.정답률 ?? "—"}% <i>({s.표본}문)</i>
                  </span>
                ) : null;
              })}
              {Object.entries(day.원인 || {}).map(([c, n]) => (
                <span key={c} className={q.causeChip}>{CAUSE[c] || c} {n}</span>
              ))}
            </div>
          </section>

          {/* 문항 목록 */}
          <section className={q.card}>
            <div className={q.listHead}>
              <div className={q.cardTitle}>문항 {day.문항.length}건</div>
              <div className={q.filters}>
                {["전체", "오답", "검토필요", "정답"].map((f) => (
                  <button key={f} className={`${q.fBtn} ${filter === f ? q.fActive : ""}`} onClick={() => setFilter(f)}>{f}</button>
                ))}
              </div>
            </div>
            <ul className={q.qList}>
              {items.map((it) => {
                const V = VERDICT[it.판정] ?? VERDICT.판정불가;
                const isOpen = open === it.id;
                return (
                  <li key={it.id} className={q.qItem}>
                    <button className={q.qRow} onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen}>
                      <span className={`${q.badge} ${q[V.cls]}`}>{V.icon} {V.label}</span>
                      <span className={q.qText}>{it.질문}</span>
                      <span className={q.qMeta}>
                        {it.회귀 ? <span className={q.reg}>재검</span> : null}
                        <span className={q.type}>{it.유형}</span>
                        {(it.주제 || []).slice(0, 1).map((t) => <span key={t} className={q.topic}>{t}</span>)}
                      </span>
                      <span className={q.caret}>{isOpen ? "▴" : "▾"}</span>
                    </button>
                    {isOpen ? (
                      <div className={q.qDetail}>
                        <div className={q.dSec}><b>챗봇 답변</b><div className={q.answer}>{it.답변 || "(없음)"}</div></div>
                        {it.근거문장 ? <div className={q.dSec}><b>정답 근거(원문)</b><div className={q.golden}>「{it.근거문장}」</div></div> : null}
                        {it.증거 ? <div className={q.dSec}><b>{it.판정 === "오답" ? "오답 근거" : "검토 사유"}</b><div className={q.evidence}>{it.증거}</div></div> : null}
                        <div className={q.dFoot}>
                          {it.원인 ? <span className={q.causeChip}>{CAUSE[it.원인] || it.원인}</span> : null}
                          {it.출처?.규정명 ? (
                            <Link className={q.srcLink} href={`/d/${encodeURIComponent(it.출처.규정명)}/${it.출처.조 ? `#${encodeURIComponent(it.출처.조)}` : ""}`}>
                              📄 {it.출처.규정명} {it.출처.조} →
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {items.length === 0 ? <li className={q.emptyRow}>해당 판정의 문항이 없어요.</li> : null}
            </ul>
          </section>
          <p className={q.note}>
            ※ 문항은 규정 청크에서 자동 생성하고(그 청크가 정답 근거), 답변은 실서비스와 같은 구성으로 받아
            원문과 대조해 자동 채점합니다. 오답은 원문 대조로 증명된 것만 표시하며, 콘텐츠 수정은 사람이
            검수·확정합니다. 실제 이용자 질문은 포함되지 않습니다(합성 문항만).
          </p>
        </>
      )}
    </Layout>
  );
}
