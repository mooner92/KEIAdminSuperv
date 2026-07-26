import { useState, type ReactNode } from "react";
import s from "./BrowseShell.module.css";

/** 공용 브라우즈 셸(호롱 03 → 공용 승격, 사용자 지시 2026-07-24) — "문서 찾기(문서)"의
 * 검증된 구조를 컴포넌트로 정의한 것.
 *
 * 구조 계약(⚠ fill 페이지 전제 — Layout fill의 innerFill(flex column) 아래에서 사용):
 *   [side]  좌 248px 필터 카드 — 자체 내부 스크롤(사이드 전체가 하나의 스크롤)
 *   [head]  우측 상단 고정 영역 — 검색창·칩·컨트롤(목록을 스크롤해도 움직이지 않는다)
 *   [children] 우측 목록 영역 — flex:1 + min-height:0, **여기만** 스크롤
 * 모바일(≤760px): grid 해제·자연 흐름, side는 토글 버튼으로 접이(목록이 첫 화면).
 *
 * PagedList와 함께 쓸 때: children에 PagedList를 넣으면 컨트롤 줄(건수·N개씩)은 고정되고
 * PagedList의 children(목록)만 스크롤되도록 .pagedFill이 flex 계약을 전파한다.
 * Explorer(문서 탭)는 동일 구조의 원본 — 추후 이 셸로 마이그레이션 대상(회귀 방지 위해 이번엔 미변경).
 */
export default function BrowseShell({ side, head, children, sideTitle = "필터", reset }: {
  side: ReactNode;
  head?: ReactNode;
  children: ReactNode;
  sideTitle?: string;
  reset?: { count: number; onClick: () => void } | null;
}) {
  const [open, setOpen] = useState(false); // 모바일 필터 접이
  return (
    <>
      <button type="button" className={s.mToggle} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? `${sideTitle} 접기 ▴` : `${sideTitle} 열기 ▾${reset && reset.count > 0 ? ` · ${reset.count}개 적용 중` : ""}`}
      </button>
      <div className={s.wrap}>
        <aside className={`${s.side} ${open ? s.sideOpenM : ""}`} aria-label={sideTitle}>
          <div className={s.sideHead}>
            <span className={s.sideTitle}>{sideTitle}</span>
            {reset && reset.count > 0 ? (
              <button className={s.reset} onClick={reset.onClick}>초기화 {reset.count}</button>
            ) : null}
          </div>
          {side}
        </aside>
        <div className={s.content}>
          {head ? <div className={s.head}>{head}</div> : null}
          <div className={`${s.body} ${s.pagedFill}`}>{children}</div>
        </div>
      </div>
    </>
  );
}
