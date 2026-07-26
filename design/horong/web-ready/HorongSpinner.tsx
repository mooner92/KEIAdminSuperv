import { useId } from "react";

/**
 * 호롱빛 로딩 스피너 — 잎이 피고 지며 도는 불빛. 순수 SVG+CSS (GIF 아님).
 * variant="bloom"  잎이 자라났다 사그라드는 웨이브 + 12s 저속 회전 (대표안)
 * variant="tick"   잎은 고정, 밝기만 차례로 꺼지며 도는 iOS 스타일
 * 전역 CSS(globals.css)에 아래 keyframes를 1회 추가:
 *   @keyframes hrLeafTick  { from { opacity: 1 } to { opacity: 0.12 } }
 *   @keyframes hrLeafBloom { 0% { opacity: 0; transform: scale(0.45) } 18% { opacity: 1; transform: scale(1) }
 *                            55% { opacity: 1; transform: scale(1) } 100% { opacity: 0; transform: scale(0.55) } }
 *   @keyframes hrSlowSpin  { from { transform: rotate(0) } to { transform: rotate(360deg) } }
 *   @media (prefers-reduced-motion: reduce) { .hr-spin * { animation: none !important; opacity: 0.7 !important } }
 */
export default function HorongSpinner({
  size = 24,
  variant = "bloom",
  label = "불러오는 중",
}: {
  size?: number;
  variant?: "bloom" | "tick";
  label?: string;
}) {
  const id = useId();
  const N = 8;
  const leaves = Array.from({ length: N }, (_, i) => {
    const style: React.CSSProperties =
      variant === "bloom"
        ? {
            transformOrigin: "32px 32px",
            animation: "hrLeafBloom 1.6s cubic-bezier(0.3,0,0.4,1) infinite",
            animationDelay: `${-1.6 + (1.6 / N) * i}s`,
          }
        : {
            animation: "hrLeafTick 1s linear infinite",
            animationDelay: `${-1 + (1 / N) * i}s`,
          };
    return (
      <g key={i} transform={`rotate(${(360 / N) * i} 32 32)`}>
        <path
          d="M32 27 C 30.2 20.5 30.2 13 32 5.5 C 33.8 13 33.8 20.5 32 27 Z"
          fill={`url(#${id})`}
          style={style}
        />
      </g>
    );
  });
  return (
    <svg className="hr-spin" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0.2" stopColor="#2c9c62" />
          <stop offset="0.48" stopColor="#ffd54f" />
          <stop offset="0.66" stopColor="#f9a825" />
          <stop offset="1" stopColor="#e8420b" />
        </linearGradient>
      </defs>
      {variant === "bloom" ? (
        <g style={{ transformOrigin: "32px 32px", animation: "hrSlowSpin 12s linear infinite" }}>{leaves}</g>
      ) : (
        leaves
      )}
    </svg>
  );
}
