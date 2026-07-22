import { useState } from "react";
import Link from "next/link";
import { addOffset, downloadIcs, ko } from "../DeadlineCalc";
import type { DeadlineEntry } from "../../lib/vault";
import d from "../../styles/Deadlines.module.css";

// 기한 사전(docs/57) 브라우즈 행 — 드로어 DeadlineCalc.Row와 달리 '규정명 링크'를 함께 노출(교차규정).
// 계산은 DeadlineCalc의 순수 산술 헬퍼 재사용(DRY). ⛔ 절대 규칙1: 오프셋·원문 불변, 마감일=산술.
// 기간한도(지속기간 상한)도 계산 지원 — 시작일 입력 → '최대 언제까지'(같은 산술, 의미만 다름).
export default function DeadlineBrowseRow({ e }: { e: DeadlineEntry }) {
  const [base, setBase] = useState("");
  const isCap = e.type === "기간한도";
  const canCalc = e.n > 0 && !!e.unit; // 마감(기준일→마감)·기간한도(시작일→최대종료) 모두 산술 가능
  const result = base && canCalc ? addOffset(new Date(base + "T00:00:00"), e.n, e.unit, e.dir) : null;
  const src = `${e.규정명}${e.regNo ? ` (규정번호 ${e.regNo})` : ""} ${e.조}`;
  const summary = isCap
    ? `[기간한도] ${e.라벨대상 || e.의무 || "기간"} — ${e.규정명} ${e.조}`
    : `[마감] ${e.라벨행동 || e.의무 || "처리"} — ${e.규정명} ${e.조}`;
  // 제목 우선순위: 자동 라벨(사건) → 기간한도의 대상 → 원시 anchor → 조 폴백("기준일" 단독 금지)
  const title = e.라벨사건 || (isCap ? e.라벨대상 : "") || e.anchor || `${e.조}의 기한`;
  const duty = e.라벨행동 || e.의무;
  return (
    <li className={d.row}>
      <div className={d.head}>
        <span className={d.anchor}
          title={e.라벨사건 || e.라벨대상 ? "자동 생성 라벨(검수 전) — 원문으로 확인하세요" : undefined}>
          {title}
        </span>
        <b className={d.offset}>
          {e.n}{e.unit} {e.dir === "전" ? "전까지" : "이내"}
        </b>
        {duty && duty !== title ? <span className={d.duty}>{duty}</span> : null}
        {isCap ? <span className={d.tag}>기간 한도</span> : null}
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
            {isCap ? "시작일" : "기준일"}
            <input type="date" value={base} onChange={(ev) => setBase(ev.target.value)} className={d.date} />
          </label>
          {result ? (
            <>
              <span className={d.arrow}>→</span>
              <span className={d.deadline}>{isCap ? "최대" : "마감"} {ko(result)}{isCap ? "까지" : ""}</span>
              <button className={d.ics} onClick={() => downloadIcs(summary, result, `근거: ${src}\n${e.원문}`)}>
                📅 캘린더(.ics)
              </button>
            </>
          ) : (
            <span className={d.hint}>{isCap ? "시작일을 넣으면 최대 기간이 계산돼요" : "날짜를 넣으면 마감일이 계산돼요"}</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
