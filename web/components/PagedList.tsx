import { useMemo, useState, type ReactNode } from "react";
import s from "./PagedList.module.css";

// 공용 목록 컨테이너(사용자 요청 2026-07-19): 모든 목록형 UI의 공통 골격.
// - 컨트롤은 전부 **상단 한 줄**(건수 · [필터 슬롯] · N개씩 칩 · ‹ n/N ›) — 목록 아래엔 아무것도
//   두지 않는다("동작할 때마다 내려서 눌러야" 하는 문제 제거).
// - 내부 렌더는 children(paged) 함수 — 카드 목록이든 <table>이든 용도별 아이템 컴포넌트를
//   그대로 꽂는다(세부 버튼이 달라도 무관). 필터 UI도 슬롯(filterSlot)이라 용도별 자유.
// - 정렬·필터링은 부모가 끝낸 items를 준다(이 컴포넌트는 표시·페이지만 담당 — 단일 책임).
// - 필터가 바뀌면 부모가 resetKey를 바꿔 1페이지로 복귀시킨다.
export default function PagedList<T>({
  items, children, sizes = [10, 30, 50], defaultSize, unit = "건",
  note, filterSlot, resetKey = "", empty = "표시할 항목이 없어요.",
}: {
  items: T[];
  children: (paged: T[]) => ReactNode;
  sizes?: readonly number[];
  defaultSize?: number;
  unit?: string;              // "건" | "명" | "개" …
  note?: string;              // 건수 옆 부가 설명(예: "최신순")
  filterSlot?: ReactNode;     // 용도별 필터 칩/검색창(상단 줄에 합류)
  resetKey?: string | number; // 바뀌면 1페이지로(필터 변경 시 부모가 갱신)
  empty?: string;
}) {
  const [pageSize, setPageSize] = useState<number>(defaultSize ?? sizes[0]);
  const [page, setPage] = useState(1);
  const [lastReset, setLastReset] = useState(resetKey);
  if (lastReset !== resetKey) { // 렌더 중 상태 보정(공식 패턴) — 필터 변경 → 1페이지
    setLastReset(resetKey);
    setPage(1);
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(page, pageCount);
  const paged = useMemo(
    () => items.slice((cur - 1) * pageSize, cur * pageSize),
    [items, cur, pageSize]);

  return (
    <div>
      <div className={s.controls}>
        <span className={s.count}>{items.length.toLocaleString()}{unit}{note ? ` · ${note}` : ""}</span>
        {filterSlot}
        <span className={s.pager}>
          {sizes.map((n) => (
            <button key={n} className={`${s.chip} ${pageSize === n ? s.chipOn : ""}`}
              onClick={() => { setPageSize(n); setPage(1); }}>{n}{unit === "명" ? "명" : "개"}씩</button>
          ))}
          <button className={s.nav} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
          <span className={s.pageNo}>{cur} / {pageCount}</span>
          <button className={s.nav} disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
        </span>
      </div>
      {items.length === 0 ? <p className={s.empty}>{empty}</p> : children(paged)}
    </div>
  );
}
