import s from "./AmountInput.module.css";

/** 금액 입력 공용 프리미티브(2026-07-26) — "370만", "1,000만원", "3억" 자유 입력.
 *  해석된 값을 옆에 되비쳐(370만원 = 3,700,000원) 오입력을 즉시 알아채게 한다.
 *  ⛔ 판정 로직 없음(표시 전용) — 구간 판정은 lib/amountRules가 담당. */
export default function AmountInput({ value, onChange, parsed, placeholder = "금액 (예: 370만)", ariaLabel = "금액" }: {
  value: string;
  onChange: (v: string) => void;
  parsed: number | null;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const invalid = value.trim() !== "" && parsed === null;
  return (
    <span className={s.wrap}>
      <span className={s.icon} aria-hidden>₩</span>
      <input
        className={`${s.input} ${invalid ? s.invalid : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        inputMode="numeric"
      />
      {parsed !== null ? (
        <span className={s.echo} aria-live="polite">= {parsed.toLocaleString()}원</span>
      ) : invalid ? (
        <span className={s.hint}>숫자로 입력해 주세요</span>
      ) : null}
      {value ? (
        <button type="button" className={s.clear} onClick={() => onChange("")} aria-label="금액 지우기">✕</button>
      ) : null}
    </span>
  );
}
