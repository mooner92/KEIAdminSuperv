import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Layout from "../../components/Layout";
import PageHero from "../../components/common/PageHero";
import PagedList from "../../components/common/PagedList";
import DataTable from "../../components/common/DataTable";
import AsyncState from "../../components/common/AsyncState";
import { useFlag } from "../../lib/flags";
import { SITE_NAME } from "../../lib/site";
import q from "../../styles/Quality.module.css";

// 전체 자가평가 이력(2026-07-25 사용자 요청) — 메인 게시판은 최근 7일만 보여주고,
// 누적 이력은 이 페이지에서 **공용 목록 컴포넌트**(PagedList 상단 컨트롤 + DataTable)로 본다.
// 데이터는 메인과 동일하게 런타임 fetch(server.js가 web/public/quality 직서빙, 매일 갱신).

type Day = { date: string; 정답률: number | null; 집계: Record<string, number> };
type Idx = { days: Day[] };

function accColor(a: number | null | undefined): string {
  if (a == null) return "var(--color-text-disabled)";
  if (a >= 90) return "var(--color-success)";
  if (a >= 75) return "var(--color-text)";
  if (a >= 60) return "var(--color-warning)";
  return "var(--color-danger)";
}

export default function QualityTrendPage() {
  const on = useFlag("quality_board");
  const [idx, setIdx] = useState<Idx | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/quality/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("불러오지 못했어요"))))
      .then(setIdx)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  // 최신순 — 표본이 없는 날(정답률 null)도 그대로 보여준다(측정 공백을 숨기지 않음)
  const rows = useMemo(() => [...(idx?.days ?? [])].reverse(), [idx]);
  const 평균 = useMemo(() => {
    const v = rows.map((d) => d.정답률).filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  }, [rows]);

  if (!on) {
    return (
      <Layout>
        <PageHero title="전체 자가평가 이력" lead="이 기능은 아직 준비 중이에요." />
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>{`전체 자가평가 이력 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero
        title="전체 자가평가 이력"
        lead={<>매일 새벽 자동 평가의 <b>누적 기록</b>이에요(최근 90일 보관).{평균 != null ? <> 기간 평균 정답률 <b>{평균}%</b>.</> : null}{" "}
          <Link className={q.moreLink} href="/quality/">← 품질 게시판으로</Link></>}
      />
      {!idx || err ? (
        <AsyncState loading={!idx && !err} error={err} />
      ) : (
        <PagedList
          items={rows}
          unit="일"
          defaultSize={30}
          note="최신순"
          empty="아직 쌓인 평가 이력이 없어요."
        >
          {(paged) => (
            <DataTable
              rows={paged}
              rowKey={(d) => d.date}
              cols={[
                { key: "date", head: "날짜", render: (d) => <span className={q.tDate}>{d.date}</span> },
                { key: "acc", head: "정답률", num: true, render: (d) => (
                  <span className={q.tAcc} style={{ color: accColor(d.정답률) }}>
                    {d.정답률 == null ? "—" : `${d.정답률}%`}
                  </span>) },
                { key: "bar", head: "", render: (d) => (
                  <span className={q.tBar}><span className={q.tBarFill}
                    style={{ width: `${d.정답률 ?? 0}%`, background: accColor(d.정답률) }} /></span>) },
                { key: "ok", head: "✅ 정답", num: true, render: (d) => d.집계["정답"] || 0 },
                { key: "ng", head: "❌ 오답", num: true, render: (d) => (
                  <span className={(d.집계["오답"] || 0) > 0 ? q.tBad : undefined}>{d.집계["오답"] || 0}</span>) },
                { key: "rv", head: "🔍 검토", num: true, render: (d) => d.집계["검토필요"] || 0 },
                { key: "etc", head: "기타", num: true, render: (d) => (
                  <span className={q.mutedSm}>{((d.집계["판정불가"] || 0) + (d.집계["폐기"] || 0)) || "—"}</span>) },
                { key: "n", head: "문항", num: true, render: (d) => (
                  Object.values(d.집계).reduce((s, n) => s + (n || 0), 0)) },
              ]}
            />
          )}
        </PagedList>
      )}
    </Layout>
  );
}
