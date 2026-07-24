import Link from "next/link";
import type { MonthlySurvey } from "../../lib/vault";
import c from "../../styles/Calendar.module.css";

// 월 상세 패널(2026-07-24, 사용자 지적 — 캘린더 부실 개선): 3개년 관측 건수 + 연도별
// 월별 특징 + 관련 대외업무 노트. ⛔ 전부 운영 통계(규정 아님) — 문구 유지.
export default function MonthDetail({ month, survey, onClose }: {
  month: number; survey: MonthlySurvey; onClose: () => void;
}) {
  const d = survey.months[String(month)];
  if (!d) return null;
  const maxN = Math.max(...d.counts.map((x) => x.n || 0), 1);
  return (
    <section className={c.detail} aria-label={`${month}월 대외업무 상세`}>
      <div className={c.detailHead}>
        <h3 className={c.detailTitle}>{month}월 대외업무 — 3개년 관측</h3>
        <button className={c.detailClose} onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className={c.detailCounts}>
        {d.counts.map((x) => (
          <div key={x.year} className={c.countRow}>
            <span className={c.countYear}>{x.year}</span>
            <span className={c.countBar}>
              <span className={c.countFill} style={{ width: `${((x.n || 0) / maxN) * 100}%` }} />
            </span>
            <b className={c.countN}>{x.n == null ? "—" : `${x.n}건`}</b>
          </div>
        ))}
      </div>
      {d.features.length ? (
        <div className={c.detailFeats}>
          {d.features.map((f) => (
            <p key={f.year} className={c.featRow}>
              <span className={c.featYear}>{f.year}</span> {f.text}
            </p>
          ))}
        </div>
      ) : <p className={c.cellEmpty}>이 달의 특징 기록이 없어요.</p>}
      {d.notes.length ? (
        <div className={c.detailNotes}>
          <span className={c.notesLabel}>관련 업무 가이드</span>
          {d.notes.map((n) => (
            <Link key={n} href={`/d/${encodeURIComponent(n)}/`} className={c.noteChip}>{n} →</Link>
          ))}
        </div>
      ) : null}
      <p className={c.detailFoot}>ⓘ 대외업무관리시스템 3개년 관측 통계 — 규정상 의무·기한이 아니에요.</p>
    </section>
  );
}
