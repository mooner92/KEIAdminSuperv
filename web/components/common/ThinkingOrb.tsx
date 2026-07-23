import { useEffect, useRef } from "react";

/** 사고 구슬(thinking orb) — 채팅 대기 표시용 점 격자 구체 애니메이션.
 *
 * 시각 컨셉은 오픈소스 'thinking-orbs'(MIT, Jakub Antalik)에서 영감 — 코드 이식이 아니라
 * 기법(위경도 점 격자 → yaw 정사영 → 깊이=크기·알파)만 차용한 독자 구현(외부 의존성 0 원칙).
 * - canvas 2D + rAF, WebGL·필터 없음. 다크/라이트는 CSS 변수(--color-text-secondary)를 mount 시 해석.
 * - state: "searching"(경선 스캔 — 규정 검색 중) | "working"(궤도 입자 — 답변 작성 중)
 * - prefers-reduced-motion: 정적 1프레임만 렌더.
 */
export default function ThinkingOrb({ state = "working", size = 20 }: {
  state?: "searching" | "working";
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ink = getComputedStyle(cv).color || "#666"; // currentColor — 테마 토큰 상속
    const R = (size / 2) * 0.86 * dpr;
    const cx = (size / 2) * dpr;

    // 위경도 격자 점 생성(위도별 점 수 ∝ cos(lat) — 극점 밀집 방지)
    const pts: { x: number; y: number; z: number; lon: number }[] = [];
    const LAT = 7;
    for (let i = 0; i < LAT; i++) {
      const lat = (i / (LAT - 1) - 0.5) * Math.PI; // -90°~90°
      const n = Math.max(1, Math.round(10 * Math.cos(lat)));
      for (let j = 0; j < n; j++) {
        const lon = (j / n) * Math.PI * 2;
        pts.push({ x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon), lon });
      }
    }
    // working 상태: 기울어진 궤도 입자 3개 추가
    const orbit = [0, 1, 2].map((k) => ({ phase: (k * Math.PI * 2) / 3 }));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (t: number) => {
      const yaw = t / 1400;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const tilt = 0.42;
      const proj = pts.map((p) => {
        const x1 = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
        const z1 = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
        const y1 = p.y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = p.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        // searching: 스캔 경선(현재 yaw 근처 경도만 밝게)
        let hot = 0;
        if (state === "searching") {
          const d = Math.abs((((p.lon + yaw * 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
          hot = Math.max(0, 1 - d / 0.7);
        }
        return { sx: cx + x1 * R, sy: cx + y1 * R, z: z2, hot };
      }).sort((a, b) => a.z - b.z); // painter's — 먼 점부터
      for (const q of proj) {
        const depth = (q.z + 1) / 2; // 0(뒤)~1(앞)
        ctx.globalAlpha = 0.18 + depth * 0.6 + q.hot * 0.25;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, (0.5 + depth * 0.9 + q.hot * 0.5) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state === "working") {
        for (const o of orbit) {
          const a = t / 700 + o.phase;
          const ox = Math.cos(a) * R * 1.05;
          const oz = Math.sin(a) * R * 1.05;
          const oy = ox * 0.35; // 기울어진 궤도
          const depth = (Math.sin(a) + 1) / 2;
          ctx.globalAlpha = 0.35 + depth * 0.55;
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(cx + ox, cx + oy + oz * 0.3, (0.9 + depth * 0.8) * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state, size]);

  return (
    <canvas ref={ref} role="img" aria-hidden
      style={{ width: size, height: size, verticalAlign: "-4px", color: "var(--color-text-secondary)" }} />
  );
}
