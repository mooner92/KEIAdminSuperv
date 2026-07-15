import type { ChangeEvent } from "react";
import styles from "./SearchInput.module.css";

/** 검색 입력(자체 구현, docs/37 D1) — TDS SearchField 대체.
 * 기존 룩 복제: 옅은 회색 라운드 필드 + 좌측 돋보기 + 값 있을 때 ✕ 클리어.
 * 시맨틱 토큰만 사용 → 라이트/다크 자동(별도 테마 래퍼 불필요 — ColorSchemeArea 제거 근거). */
export default function SearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={styles.wrap}>
      <svg className={styles.icon} viewBox="0 0 20 20" width="18" height="18" aria-hidden>
        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="13.2" y1="13.2" x2="17" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        className={styles.input}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {value ? (
        <button type="button" className={styles.clear} onClick={onClear} aria-label="검색어 지우기">
          ✕
        </button>
      ) : null}
    </div>
  );
}
