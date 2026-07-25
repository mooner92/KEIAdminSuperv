import type { ReactNode } from "react";
import s from "./BrowseUI.module.css";

/** 좌측 필터 그룹 — 제목 + 구분선(그룹 경계). 정본은 '문서' 탭(Explorer) 구조.
 *  scroll=true면 목록이 길어도 그룹 안에서만 스크롤(분류처럼 항목이 많은 그룹). */
export function FilterGroup({ title, children, scroll = false }: {
  title: string; children: ReactNode; scroll?: boolean;
}) {
  return (
    <div className={s.group}>
      <div className={s.groupTitle}>{title}</div>
      {scroll ? <div className={s.scrollGroup}>{children}</div> : children}
    </div>
  );
}

/** 체크 행 — 라벨 + 패싯 건수. 결과 0건이면 흐리게(선택 중이면 유지). */
export function FilterCheck({ label, count, checked, onChange }: {
  label: string; count?: number; checked: boolean; onChange: () => void;
}) {
  const muted = count === 0 && !checked;
  return (
    <label className={`${s.check} ${muted ? s.checkMuted : ""}`}>
      <input type="checkbox" className={s.hrCheck} checked={checked} onChange={onChange} />
      <span className={s.checkLabel}>{label}</span>
      {typeof count === "number" ? <span className={s.checkCount}>{count}</span> : null}
    </label>
  );
}

/** 필터 패널 안 '좁히기' 검색 — 항목이 많은 그룹(규정명 등)에서 사용. */
export function FilterSearch({ value, onChange, placeholder, ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder: string; ariaLabel: string;
}) {
  return (
    <input className={s.sideSearch} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} aria-label={ariaLabel} />
  );
}

export function FilterEmpty({ children }: { children: ReactNode }) {
  return <p className={s.sideEmpty}>{children}</p>;
}
