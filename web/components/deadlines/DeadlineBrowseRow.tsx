import { useState } from "react";
import Link from "next/link";
import { addOffset, downloadIcs, ko } from "../DeadlineCalc";
import type { DeadlineEntry } from "../../lib/vault";
import d from "../../styles/Deadlines.module.css";

// 기한 사전(docs/57) 브라우즈 행 — 드로어 DeadlineCalc.Row와 달리 '규정명 링크'를 함께 노출(교차규정).
// 계산은 DeadlineCalc의 순수 산술 헬퍼 재사용(DRY). ⛔ 절대 규칙1: 오프셋·원문 불변, 마감일=산술.
export default function DeadlineBrowseRow({ e }: { e: DeadlineEntry }) {
  const [base, setBase] = useState("");
  const canCalc = e.type === "마감" && e.n > 0 && !!e.unit;
  const result = base && canCalc ? addOffset(new Date(base + "T00:00:00"), e.n, e.unit, e.dir) : null;
  const src = `${e.규정명}${e.regNo ? ` (규정번호 ${e.regNo})` : ""} ${e.조}`;
  const summary = `[마감] ${e.의무 || "처리"} — ${e.규정명} ${e.조}`;
  // 제목 = 자동 라벨(01m2, 검증 게이트 통과) 우선 → 원시 anchor 폴백. 행동 라벨은 의무 대신/보강.
  const title = e.라벨사건 || e.anchor || "기준일";
  const duty = e.라벨행동 || e.의무;
  return (
    <li className={d.row}>
      <div className={d.head}>
        <span className={d.anchor} title={e.라벨사건 ? "자동 생성 라벨(검수 전) — 원문으로 확인하세요" : undefined}>
          {title}
        </span>
        <b className={d.offset}>
          {e.n}{e.unit} {e.dir === "전" ? "전까지" : "이내"}
        </b>
        {duty ? <span className={d.duty}>{duty}</span> : null}
        {e.type === "기간한도" ? <span className={d.tag}>기간 한도</span> : null}
      </div>
      <div className={d.regLine}>
        {e.slug ? (
          <Link className={d.regLink} href={`/d/${encodeURIComponent(e.slug)}/#${encodeURIComponent(e.조)}`}>
            {e.규정명} {e.조} →
          </Link>
        ) : (
          <span className={d.regFlat}>{e.규정명} {e.조}</span>
        )}
      </div>
      <div className={d.src}>📄 {e.원문}</div>
      {canCalc ? (
        <div className={d.calc}>
          <label className={d.calcLabel}>
            기준일
            <input type="date" value={base} onChange={(ev) => setBase(ev.target.value)} className={d.date} />
          </label>
          {result ? (
            <>
              <span className={d.arrow}>→</span>
              <span className={d.deadline}>마감 {ko(result)}</span>
              <button className={d.ics} onClick={() => downloadIcs(summary, result, `근거: ${src}\n${e.원문}`)}>
                📅 캘린더(.ics)
              </button>
            </>
          ) : (
            <span className={d.hint}>날짜를 넣으면 마감일이 계산돼요</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
