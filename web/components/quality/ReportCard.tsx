import { useEffect, useState } from "react";
import q from "../../styles/Quality.module.css";
import s from "./ReportCard.module.css";

/** 오늘의 분석서(specs/12 T02) — eval/daily_report.py가 매일 굽는 결정적 분석을 게시판에 얹는다.
 *
 * 화면에 올리는 것은 **두 갈래 수치와 행동 후보**뿐이다. 전문(.md)은 링크로 넘긴다 —
 * 여기서 문항을 다시 나열하면 아래 문항 목록과 중복되고, 길어진 게시판은 아무도 안 본다.
 * ⛔ 분석서가 없는 날에도 게시판은 정상이어야 한다(파일 없으면 이 카드만 사라진다).
 */
type Report = {
  어휘갭: { 정답률차: number; 검색실패배수: number | null } | null;
  수술대기: { 실패유형: string }[];
  측정노이즈: Record<string, number>;
  행동후보: string[];
};

export default function ReportCard({ date }: { date: string }) {
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    let live = true;
    setR(null);
    fetch(`/quality/reports/${date}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (live) setR(d); })
      .catch(() => { /* 분석서 없음 = 정상(구 회차·생성 실패) — 조용히 감춘다 */ });
    return () => { live = false; };
  }, [date]);

  if (!r) return null;
  const surgery = r.수술대기?.length ?? 0;
  const noise = Object.values(r.측정노이즈 || {}).reduce((a, b) => a + b, 0);

  return (
    <section className={`${q.trendCard} ${s.card}`}>
      <div className={q.cardTitle}>
        오늘의 분석서 <span className={q.mutedSm}>(자동 생성 · 사람이 읽는 요약)</span>
        <a className={q.moreLink} href={`/quality/reports/${date}.md`} target="_blank" rel="noreferrer">
          전문 보기 →
        </a>
      </div>

      {/* 두 갈래 — 이 분리가 분석서의 존재 이유다(고칠 것 vs 시험지 문제) */}
      <div className={s.split}>
        <div className={s.half}>
          <div className={s.num}>{surgery}건</div>
          <div className={s.lab}>🔧 수술 대기<br />
            <span className={q.mutedSm}>검색실패·생성환각 — 서비스가 못 한 것</span></div>
        </div>
        <div className={s.half}>
          <div className={`${s.num} ${s.muted}`}>{noise}건</div>
          <div className={s.lab}>측정 노이즈<br />
            <span className={q.mutedSm}>출제결함·골든품질 — 시험지 쪽 문제</span></div>
        </div>
      </div>

      {r.어휘갭 ? (
        <p className={s.gap}>
          <b>어휘 갭 {r.어휘갭.정답률차}%p</b>
          {r.어휘갭.검색실패배수 ? ` · 검색실패 ${r.어휘갭.검색실패배수}배` : ""}
          <span className={q.mutedSm}> — 같은 정답을 평소 말로 물으면 이만큼 못 찾아요</span>
        </p>
      ) : null}

      {r.행동후보?.length ? (
        <ol className={s.actions}>
          {r.행동후보.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
      ) : null}
    </section>
  );
}
