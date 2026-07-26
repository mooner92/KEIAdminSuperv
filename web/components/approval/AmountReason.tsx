import type { AmountRange } from "../../lib/amountRules";
import s from "./AmountReason.module.css";

/** "왜 이 전결인가" — 금액 구간 근거 표시(specs/06 D2).
 *  ⛔ 판정 결과만 보여주지 않는다: **구간 표기 + 별표 원문행**을 함께 노출해
 *  사용자가 규정 원문으로 검증할 수 있게 한다(근거 없는 판정 금지 원칙). */
export default function AmountReason({ range, amountLabel }: {
  range: AmountRange;
  amountLabel: string;
}) {
  const bare = range.표기.split("(사다리 절단")[0].trim();
  return (
    <span className={s.wrap}>
      <span className={s.badge}>{amountLabel} → {bare}</span>
      {range.근거?.원문행 ? (
        <span className={s.src} title="위임전결규정 별표 원문 행">별표 원문: {range.근거.원문행.trim()}</span>
      ) : null}
    </span>
  );
}
