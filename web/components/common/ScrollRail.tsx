import { useEffect, useRef, useState } from "react";
import styles from "./ScrollRail.module.css";

// 우측 스크롤 레일(docs/36 §1·P4, x.ai 벤치마킹) — 섹션 라벨을 세로로 등간격 배치,
// 현재 섹션 하이라이트(aria-current), 클릭/Enter로 점프. 재사용 컴포넌트(랜딩·도움말·긴 문서).
//  - 라벨은 등간격 flex 배치(비율 배치 아님) → 섹션이 몰려도 겹치지 않음(클릭 가로채기 제거)
//  - 활성 섹션만 스크롤 위치로 추적(rect.top+scrollY, offsetParent 함정 회피), body ResizeObserver 재계산
//  - 각 섹션 scroll-margin-top으로 sticky 헤더 가림 방지, ≤880px는 CSS에서 숨김

export type RailItem = { id: string; label: string };

export default function ScrollRail({ items }: { items: RailItem[] }) {
  const [active, setActive] = useState(0);
  const tops = useRef<number[]>([]);

  useEffect(() => {
    const measure = () => {
      tops.current = items.map((it) => {
        const el = document.getElementById(it.id);
        return el ? el.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY;
      });
    };
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mark = window.scrollY + window.innerHeight * 0.4;
        let a = 0;
        tops.current.forEach((y, i) => { if (mark >= y) a = i; });
        // 바닥 도달 시 마지막 섹션 강제 활성(짧은 마지막 섹션이 40% 지점을 못 넘는 경우 보정)
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
          a = items.length - 1;
        }
        setActive(a);
      });
    };
    measure();
    onScroll();
    const ro = new ResizeObserver(() => { measure(); onScroll(); });
    ro.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => { measure(); onScroll(); });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  const jump = (id: string) => {
    // scroll-margin-top(각 섹션 CSS)이 sticky 헤더 가림을 막는다
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
