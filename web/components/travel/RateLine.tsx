import ResultRow, { RowChip, RowTag, RowBadge } from "../common/ResultRow";
import s from "./Travel.module.css";

/** 여비 항목 한 줄 — 공용 ResultRow 3열 스킨 사용(목록 CSS 사본 금지 규약).
 *  ⛔ 절대 규칙2: 모든 줄에 근거(별표·원문행)를 함께 표시한다.
 *  ⛔ 절대 규칙3: 금액이 확정되지 않은 항목(실비 등)은 계산하지 않고 "원문 확인"을 보여준다. */
export default function RateLine({
  항목, 값, 계산, 근거, 원문행, 태그, 미확정, 실비,
}: {
  항목: string;
  /** 표에 적힌 원문 값 그대로(예: "25,000", "실비 (일반실)") */
  값: string;
  /** 정액 × 일수 계산식 — 확정 금액이 있을 때만. 없으면 undefined */
  계산?: string;
  근거: string;      // 예: "여비규정 별표 2"
  원문행: string;    // 별표 표의 그 줄 그대로
  태그?: string;     // 정액 · 상한 · 실비 …
  미확정?: boolean;  // 금액을 확정하지 못함 → 빈칸 + 원문 확인 안내
  실비?: boolean;
}) {
  return (
    <ResultRow
      title={<>{항목} <span className={s.src}>{값}</span></>}
      chips={
        <>
          <RowChip section="규정집">{근거}</RowChip>
          {태그 ? <RowTag>{태그}</RowTag> : null}
          {실비 ? <RowBadge>실비 — 영수증 기준</RowBadge> : null}
        </>
      }
      snippet={<span className={s.src}>📄 {원문행}</span>}
      right={
        미확정 ? (
          <span className={s.missing}>원문 확인</span>
        ) : 계산 ? (
          <b>{계산}</b>
        ) : null /* 계산할 정액이 없는 항목(실비·좌석등급)은 제목에 원문 값이 이미 있다 — 중복 표시 안 함 */
      }
    />
  );
}
