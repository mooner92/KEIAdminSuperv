/** 호롱 v2 아이콘 세트(design/horong-v2 — Spotify 리디자인).
 * 24px viewBox · 스트로크 1.8 · 라운드 캡. 이모지 아이콘 전면 폐기의 대체.
 * ⛔ 색은 currentColor만 — 색 결정은 쓰는 쪽(시맨틱 토큰)이 한다(P1). */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 21, ...rest }: P) {
  return {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true, ...rest,
  };
}

/** 말풍선 — 질문하기 */
export function IconChat(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M21 11.6a7.8 7.8 0 0 1-8.3 7.7 8.8 8.8 0 0 1-3.2-.6L4 20l1.4-4.2a7.4 7.4 0 0 1-1.4-4.2A7.8 7.8 0 0 1 12.3 4 7.8 7.8 0 0 1 21 11.6Z" />
    </svg>
  );
}

/** 돋보기 — 문서 찾기·검색 */
export function IconSearch(p: P) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

/** 그리드 — 업무 도구 */
export function IconGrid(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  );
}

/** 캘린더 — 업무 캘린더 */
export function IconCalendar(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
    </svg>
  );
}

/** 체크 배지 — 결재선 판정기 */
export function IconCheck(p: P) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.6 12.2 2.3 2.3 4.5-4.8" />
    </svg>
  );
}

/** 실드 — 관리자 */
export function IconShield(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5 5 6v5.2c0 4.4 3 7.6 7 9.3 4-1.7 7-4.9 7-9.3V6l-7-2.5Z" />
    </svg>
  );
}

/** 문서 — 도움말·문서류 */
export function IconDoc(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" transform="translate(0 -0.5)" />
      <path d="M14 3.5V8h4.6M9 12.5h6M9 16h6" />
    </svg>
  );
}

/** 말풍선+하트 대신 종이비행기 — 의견 보내기 */
export function IconSend(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M20.5 3.8 3.6 10.2c-.8.3-.8 1.4 0 1.7l6 2.2 2.3 6c.3.8 1.4.8 1.7 0L20 4.9c.3-.7-.4-1.4-1.1-1.1Z" />
      <path d="m9.8 14.2 4.4-4.4" />
    </svg>
  );
}

/** 플러스 — 새 대화 */
export function IconPlus(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

/** 위 화살표 — 전송 */
export function IconUp(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 19V6M6.5 11 12 5.5 17.5 11" />
    </svg>
  );
}
