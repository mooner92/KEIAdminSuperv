import { useEffect, useRef, useState } from "react";
import styles from "./ScrollRail.module.css";

// 우측 스크롤 레일(docs/36 §1, x.ai 벤치마킹) — 섹션 라벨을 문서 내 위치 비율로 세로 배치,
// 현재 섹션 하이라이트(aria-current), 클릭/Enter로 점프. 재사용 규약(docs/36 §0-3):
//  - 위치는 offsetTop이 아니라 rect.top + scrollY (offsetParent 함정 회피)
//  - body ResizeObserver로 재계산 — 배너·웹폰트·미디어 로드로 문서 높이가 변한다(실측된 변동 요인)
//  - 라벨 간 최소 간격 클램프(짧은 섹션 연속 시 겹침 방지), ≤880px는 CSS에서 숨김
//  - scrollRoot 주입은 P4(fill 레이아웃 재사용) 대비 예약 — v1은 window 스크롤 전용

export type RailItem = { id: string; label: string };

export default function ScrollRail({ items }: { items: RailItem[] }) {
  const [pos, setPos] = useState<number[]>([]); // 0~1 (레일 높이 비율)
  const [active, setActive] = useState(0);
  const tops = useRef<number[]>([]); // 섹션 문서상 y — active 계산 공용

  useEffect(() => {
    const measure = () => {
      const docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const t = items.map((it) => {
        const el = document.getElementById(it.id);
        return el ? el.getBoundingClientRect().top + window.scrollY : 0;
      });
      tops.current = t;
      const p = t.map((y) => Math.min(1, Math.max(0, y / Math.max(docH, 1))));
      const MIN_GAP = 0.06; // 라벨 겹침 방지 클램프
      for (let i = 1; i < p.length; i++) if (p[i] - p[i - 1] < MIN_GAP) p[i] = p[i - 1] + MIN_GAP;
      setPos(p.map((v) => Math.min(v, 1)));
    };
    // active: 뷰포트 40% 지점을 지난 마지막 섹션
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mark = window.scrollY + window.innerHeight * 0.4;
        let a = 0;
        tops.current.forEach((y, i) => { if (mark >= y) a = i; });
        // 마지막 섹션은 짧으면 40% 지점을 영영 못 넘는다 — 바닥 도달 시 강제 활성
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
          a = tops.current.length - 1;
        }
        setActive(a);
      });
    };
    measure();
    onScroll();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [items]);

  const jump = (id: string) => {
    // scroll-margin-top(각 섹션 CSS)이 sticky 헤더 가림을 막는다
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className={styles.rail} aria-label="페이지 섹션 이동">
      <span className={styles.track} aria-hidden />
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          className={`${styles.label} ${active === i ? styles.on : ""}`}
          style={{ top: `${(pos[i] ?? 0) * 100}%` }}
          aria-current={active === i ? "true" : undefined}
          onClick={() => jump(it.id)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
