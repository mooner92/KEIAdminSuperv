import type { SeasonalItem } from "../../lib/vault";
import TitleLink from "./TitleLink";
import c from "../../styles/Calendar.module.css";

// 연간 그리드의 한 달 셀(2026-07-20 추출) — calendar.tsx가 12번 인라인 map하던 것을 컴포넌트로.
// 균일한 12칸이 '달력다움'을 만든다(docs/43). 항목은 한 줄 링크만(칩·설명 제거).
export default function MonthCell({ month, items, isNow, onOpen, opened }: {
  month: number; items: SeasonalItem[]; isNow: boolean;
  onOpen?: () => void;   // 월 상세(3개년 관측) 열기 — survey 데이터 있을 때만
  opened?: boolean;
}) {
  return (
    <section
      className={`${c.cell} ${isNow ? c.cellNow : ""} ${onOpen ? c.cellClickable : ""} ${opened ? c.cellOpened : ""}`}
      aria-label={`${month}월 업무`}
      onClick={onOpen ? (e) => {
        // 카드 전체 클릭 = 상세 토글(사용자 지시) — 단, 항목 링크 클릭은 문서 이동 우선
        if ((e.target as HTMLElement).closest("a")) return;
        onOpen();
      } : undefined}
      role={onOpen ? "button" : undefined}
      aria-expanded={onOpen ? opened : undefined}>
      <h3 className={c.cellHead}>
        <span className={c.cellNum}>{month}</span>
        <span className={c.cellWol}>월</span>
        {isNow ? <span className={c.nowBadge}>이번 달</span> : null}
        {onOpen ? <span className={`${c.cellChevron} ${opened ? c.cellChevronOn : ""}`} aria-hidden>▾</span> : null}
      </h3>
      {items.length === 0 ? (
        <p className={c.cellEmpty}>—</p>
      ) : (
        <ul className={c.cellList}>
          {items.map((it, i) => (
            <li key={i} className={c.cellItem}><TitleLink it={it} className={c.cellLink} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}
