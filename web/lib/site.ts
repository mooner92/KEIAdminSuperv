// 서비스 전역 상수(단일 출처).

// 서비스명(v1 스펙 ⑩/S5-#11) — 브랜드·타이틀·브레드크럼 루트가 모두 이 값을 쓴다.
export const SITE_NAME = "KEI 행정 가이드";

// 규정집(코퍼스) 기준일 — 규정 원문을 내려받아 볼트에 적재한 날짜.
// 규정은 개정될 수 있으므로 "이 답변/문서가 어느 시점 규정을 근거로 하는지"를 사용자에게 알린다.
// ⛔ 규정집을 새로 받아 재적재하면 이 값만 갱신하면 footer·고지에 일괄 반영된다.
export const CORPUS_AS_OF = "2026.06.19";

// 빌드 식별자(v1 ⑮/#49) — 빌드 시 NEXT_PUBLIC_BUILD_ID=$(git rev-parse --short HEAD) 주입, 미주입 시 dev
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
