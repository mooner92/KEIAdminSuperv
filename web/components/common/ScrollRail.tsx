import { useEffect, useRef, useState } from "react";
import styles from "./ScrollRail.module.css";

// 우측 스크롤 레일(docs/36 §1·P4, x.ai 벤치마킹) — 섹션 라벨을 세로로 등간격 배치,
// 현재 섹션 하이라이트(aria-current), 클릭/Enter로 점프. 재사용 컴포넌트(랜딩·도움말·긴 문서).
//  - 라벨은 등간격 flex 배치(비율 배치 아님) → 섹션이 몰려도 겹치지 않음(클릭 가로채기 제거)
//  - v2 셸(2026-07-28): 스크롤이 window가 아니라 **메인 패널(overflow-y:auto)** 안에서 일어난다.
//    window.scrollY 고정 참조가 v2에서 레일을 죽였던 원인 — 첫 섹션의 실제 스크롤 부모를 찾아
//    그 컨테이너 기준으로 추적한다(비로그인 랜딩처럼 window 스크롤이면 자동으로 window 폴백).
//  - 각 섹션 scroll-margin-top으로 상단 가림 방지, ≤880px는 CSS에서 숨김

export type RailItem = { id: string; label: string };

/** el의 실제 세로 스크롤 컨테이너(없으면 window) */
function scrollParentOf(el: Element | null): HTMLElement | Window {
  let cur = el?.parentElement || null;
  while (cur && cur !== document.body) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return window;
}

export default function ScrollRail({ items }: { items: RailItem[] }) {
  const [active, setActive] = useState(0);
  const tops = useRef<number[]>([]);

  useEffect(() => {
    const first = document.getElementById(items[0]?.id || "");
    const sc = scrollParentOf(first);
    const isWin = sc === window;
    const scrollY = () => (isWin ? window.scrollY : (sc as HTMLElement).scrollTop);
    const viewH = () => (isWin ? window.innerHeight : (sc as HTMLElement).clientHeight);
    const totalH = () => (isWin ? document.documentElement.scrollHeight : (sc as HTMLElement).scrollHeight);
    const originTop = () => (isWin ? 0 : (sc as HTMLElement).getBoundingClientRect().top);

    const measure = () => {
      tops.current = items.map((it) => {
        const el = document.getElementById(it.id);
        return el ? el.getBoundingClientRect().top - originTop() + scrollY() : Number.POSITIVE_INFINITY;
      });
    };
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mark = scrollY() + viewH() * 0.4;
        let a = 0;
        tops.current.forEach((y, i) => { if (mark >= y) a = i; });
        // 바닥 도달 시 마지막 섹션 강제 활성(짧은 마지막 섹션이 40% 지점을 못 넘는 경우 보정)
        if (scrollY() + viewH() >= totalH() - 2) a = items.length - 1;
        setActive(a);
      });
    };
    measure();
    onScroll();
    const ro = new ResizeObserver(() => { measure(); onScroll(); });
    ro.observe(isWin ? document.body : (sc as HTMLElement));
    const target: EventTarget = isWin ? window : (sc as HTMLElement);
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  const jump = (id: string) => {
    // scroll-margin-top(각 섹션 CSS)이 상단 가림을 막는다 — scrollIntoView는 컨테이너 무관 동작
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className={styles.rail} aria-label="페이지 섹션 이동">
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          className={`${styles.label} ${active === i ? styles.on : ""}`}
          aria-current={active === i ? "true" : undefined}
          onClick={() => jump(it.id)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
