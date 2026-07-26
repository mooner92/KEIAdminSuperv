import { useId } from "react";

/** 호롱 심볼 — 정적 물방울 실루엣, 그라데이션이 불을 표현. 잎맥은 옅은 흰 결. */
export default function HorongMark({ size = 27 }: { size?: number }) {
  const id = useId(); // 한 페이지 다중 렌더 시 gradient id 충돌 방지
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="호롱">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2f74b8" />
          <stop offset="0.2" stopColor="#2c9c62" />
          <stop offset="0.33" stopColor="#5db54a" />
          <stop offset="0.48" stopColor="#ffd54f" />
          <stop offset="0.66" stopColor="#f9a825" />
          <stop offset="1" stopColor="#e8420b" />
        </linearGradient>
      </defs>
      <path
        d="M32.5 4.5 C 31 12 24.5 17.5 20 23.5 C 15.5 29.5 13.5 35 14.5 41 C 16 51 23.5 57.5 32 57.5 C 40.5 57.5 48 51 49.5 41 C 50.5 35 48.5 29.5 44 23.5 C 39.5 17.5 34 12 32.5 4.5 Z"
        fill={"url(#" + id + ")"}
      />
      <path
        d="M32 52 C 31.6 44 31.8 36 32.6 24 M32 46 C 29 43.5 26.5 41 24.8 38 M32.2 40 C 35 37.5 37.2 35 38.8 31.8 M32.3 33 C 29.8 30.8 28 28.6 26.8 26"
        fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"
      />
    </svg>
  );
}
