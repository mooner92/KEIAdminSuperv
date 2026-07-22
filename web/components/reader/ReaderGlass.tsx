import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import g from "./ReaderGlass.module.css";

// 리퀴드글라스 돋보기(docs/59) — 조밀한 규정 본문을 커서 위치에서 확대해 읽는다.
// 실제 확대 = 대상 article의 DOM을 복제해 scale(전 브라우저 동작). 리퀴드 굴절 = 커서 주변
// 배경(페이지)을 SVG feDisplacementMap으로 굴절시키는 rim — backdrop-filter+SVG는 Chrome만
// 지원하므로 미지원 브라우저는 깨끗한 CSS 글라스(테두리·하이라이트)로 자연스럽게 폴백.
// 참고: kube.io/blog/liquid-glass-css-svg (convex 변위맵) — 여기선 방사형 rim 굴절로 단순·경량화.

// 다이나믹 아일랜드형 가로 필(pill) — 조밀한 규정은 '한 줄'을 넓게 읽는 게 유용(사용자 확정)
const RX = 150; // 가로 반경(px)
const RY = 68;  // 세로 반경(px)
const ZOOM = 1.9; // 확대 배율
const uid = "kei-glass-disp";

// 방사형 변위맵(중앙 평면 → rim에서 바깥으로 굴절). canvas → data URI(1회 생성, 캐시).
let _dispCache: string | null = null;
function displacementMap(w: number, h: number): string {
  if (_dispCache) return _dispCache;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx / cx, dy / cy); // 타원 정규화 거리 0(중앙)~1(rim)
      // squircle 가장자리: 바깥 22%만 굴절, smootherstep으로 부드럽게
      const e = Math.max(0, (d - 0.78) / 0.22);
      const m = e <= 0 ? 0 : e * e * e * (e * (e * 6 - 15) + 10); // smootherstep
      const ang = Math.atan2(dy, dx);
      const vx = Math.cos(ang) * m, vy = Math.sin(ang) * m;
      const i = (y * w + x) * 4;
      img.data[i] = 128 + vx * 127;      // R = X 변위
      img.data[i + 1] = 128 + vy * 127;  // G = Y 변위
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _dispCache = c.toDataURL();
  return _dispCache;
}

export default function ReaderGlass({ targetRef, onClose }: {
  targetRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [disp, setDisp] = useState<string>("");
  const lensRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  // Chrome만 backdrop-filter+SVG 지원 → rim 굴절 적용 여부
  const canRefract = typeof CSS !== "undefined"
    && (CSS.supports("backdrop-filter", `url(#${uid})`) || CSS.supports("-webkit-backdrop-filter", `url(#${uid})`));

  // 대상 본문 DOM을 렌즈에 1회 복제(정적 스냅샷) + 변위맵 준비
  useEffect(() => {
    setDisp(displacementMap(192, 96));
    const target = targetRef.current;
    const clone = cloneRef.current;
    if (!target || !clone) return;
    // outerHTML 복제 — article 자신의 클래스(패딩·타이포)가 그대로 적용돼 좌표 매핑이 정확
    clone.innerHTML = target.outerHTML;
    clone.style.width = `${target.offsetWidth}px`;
    // 복제본 안의 링크·입력 비활성(읽기 전용 확대)
    clone.querySelectorAll("a,button,input").forEach((el) => {
      (el as HTMLElement).style.pointerEvents = "none";
      el.setAttribute("tabindex", "-1");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const move = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) { setPos(null); return; }
      setPos({ x: e.clientX, y: e.clientY });
      const clone = cloneRef.current;
      if (clone) {
        // 커서 아래 본문 지점(article-local) → 렌즈 중앙(R,R)에 오도록 배치
        const px = e.clientX - r.left, py = e.clientY - r.top;
        clone.style.transform = `translate(${RX - ZOOM * px}px, ${RY - ZOOM * py}px) scale(${ZOOM})`;
      }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("keydown", key); };
  }, [targetRef, onClose]);

  return createPortal(
    <>
      {/* 변위맵 필터 정의(Chrome rim 굴절용) */}
      <svg width="0" height="0" className={g.svgDefs} aria-hidden>
        <filter id={uid} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage href={disp} x="0" y="0" width={RX * 2} height={RY * 2} result="dmap" preserveAspectRatio="none" />
          <feDisplacementMap in="SourceGraphic" in2="dmap" scale="34" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      {/* 렌즈는 항상 마운트(복제본이 채워지도록) — 커서가 본문 밖이면 visibility로 숨김 */}
      <div
        ref={lensRef}
        className={g.lens}
        style={{
          left: (pos?.x ?? -9999) - RX, top: (pos?.y ?? -9999) - RY, width: RX * 2, height: RY * 2,
          visibility: pos ? "visible" : "hidden",
        }}
        aria-hidden
      >
          {/* rim 굴절(Chrome) — 배경 페이지를 렌즈 가장자리에서 굴절 */}
          {canRefract ? <div className={g.refract} style={{ backdropFilter: `url(#${uid})`, WebkitBackdropFilter: `url(#${uid})` } as React.CSSProperties} /> : null}
          {/* 확대된 본문 복제(핵심 기능·전 브라우저) */}
          <div className={g.viewport}>
            <div ref={cloneRef} className={g.clone} />
          </div>
          {/* 유리 질감: 하이라이트 + rim */}
          <div className={g.gloss} />
          <div className={g.rim} />
      </div>
    </>,
    document.body
  );
}
