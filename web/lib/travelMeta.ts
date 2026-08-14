// 여비 계산기 — 클라이언트 안전 상수(⛔ node:fs를 쓰는 lib/travel.ts는 빌드타임 전용이라
// 컴포넌트가 값(value)으로 import하면 클라이언트 번들에 끌려 들어가 webpack이 깨진다.
// 화면에서 쓰는 상수는 여기, 타입은 lib/travel.ts에서 `import type`으로만 가져온다.)
export const TRAVEL_REG_NAME = "여비규정";
export const TRAVEL_REG_SLUG = "4300_여비규정";
