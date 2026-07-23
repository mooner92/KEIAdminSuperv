import { useState } from "react";
import Link from "next/link";
import { addOffset, downloadIcs, ko } from "../DeadlineCalc";
import type { DeadlineEntry } from "../../lib/vault";
import d from "../../styles/Deadlines.module.css";

// 기한 사전(docs/57) 브라우즈 행. 정보 순서(사용자 확정): **① 뭘 하는 기한인지(행동)가 제목**
// → ② 언제부터 얼마 이내인지(사건+오프셋) → ③ 근거 규정·원문 → ④ 계산기.
// 계산은 DeadlineCalc의 순수 산술 헬퍼 재사용(DRY). ⛔ 절대 규칙1: 오프셋·원문 불변, 마감일=산술.
export default function DeadlineBrowseRow({ e, onOpenDoc }: {
  e: DeadlineEntry;
  // 조문을 새 페이지 대신 우측 드로어로(LLM 근거 열람과 동일 UX — 흐름 유지, 사용자 지적)
  onOpenDoc?: (slug: string, anchor: string) => void;
}) {
  const [base, setBase] = useState("");
  const isCap = e.type === "기간한도";
  const canCalc = e.n > 0 && !!e.unit;
  const result = base && canCalc ? addOffset(new Date(base + "T00:00:00"), e.n, e.unit, e.dir) : null;
  const src = `${e.규정명}${e.regNo ? ` (규정번호 ${e.regNo})` : ""} ${e.조}`;
  // 제목 = 뭘 하는 기한인지: 행동(강화 라벨) → 기간한도 대상 → 사건 → 조 폴백
  const title = e.라벨행동 || e.의무 || (isCap ? e.라벨대상 : "") || e.라벨사건 || e.anchor || `${e.조}의 기한`;
  // 부제 = 언제부터: 사건(제목과 중복이면 생략)
  const when = (e.라벨사건 || e.anchor || (isCap ? "시작일부터" : "기준일부터"));
  const showWhen = when && when !== title;
  const summary = isCap ? `[기간한도] ${title} — ${e.규정명} ${e.조}` : `[마감] ${title} — ${e.규정명} ${e.조}`;
  const auto = !!(e.라벨행동 || e.라벨사건 || e.라벨대상);
  return (
    <li className={d.row}>
      <div className={d.head}>
        <span className={d.titleMain} title={auto ? "자동 생성 라벨(검수 전) — 원문으로 확인하세요" : undefined}>
          {title}
        </span>
        {isCap ? <span className={d.tag}>기간 한도</span> : null}
      </div>
      <div className={d.when}>
        ⏱ {showWhen ? <>{when} </> : null}
        <b className={d.offset}>{e.n}{e.unit} {e.dir === "전" ? "전까지" : "이내"}</b>
      </div>
      <div className={d.regLine}>
        {e.slug && onOpenDoc ? (
          <button type="button" className={d.regLink}
            onClick={() => onOpenDoc(e.slug as string, e.조)}
            title="옆 패널에서 조문 바로 보기">
            {e.규정명} {e.조} →
          </button>
        ) : e.slug ? (
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
