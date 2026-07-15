// 사용량 수집(docs/35 §0) — fire-and-forget. 🔒 이름은 서버 allowlist와 동기, 페이로드 금지.
// flag usage_analytics가 off면 서버가 무시하지만, 프론트도 불필요 전송을 줄이기 위해 캐시 확인.
import { api } from "./api";

let flagCache: boolean | null = null;
let flagInflight: Promise<boolean> | null = null; // 동시 track()이 flags를 중복 fetch하지 않게
let authMutedUntil = 0; // 401(로그아웃) 응답을 받으면 잠시 전송 중단 — 서버 로그 노이즈 방지
// 인증 상태 힌트(docs/36 §6⑦): 비로그인이 확실하면 전송 자체를 안 한다 — 401 뮤트가 로그인
// 직후 계측까지 유실시키는 부작용 차단. null=미확인(허용).
// 갱신 지점: auth.tsx AuthProvider(apply — 초기 me()·로그인·로그아웃) + Login.authed(랜딩 계측 직전 언뮤트).
let authedHint: boolean | null = null;
export function setTrackAuthed(v: boolean | null): void {
  authedHint = v;
  if (v) authMutedUntil = 0; // 로그인했으면 뮤트 즉시 해제
}

async function enabled(): Promise<boolean> {
  if (flagCache !== null) return flagCache;
  if (flagInflight) return flagInflight;
  flagInflight = api
    .flags()
    .then((f) => !!(f as Record<string, boolean>)["usage_analytics"])
    .catch(() => false)
    .then((v) => {
      flagCache = v;
      flagInflight = null;
      setTimeout(() => { flagCache = null; }, 60_000); // 1분 뒤 재확인(토글 반영)
      return v;
    });
  return flagInflight;
}

export function track(name: string, page?: string): void {
  if (authedHint === false || Date.now() < authMutedUntil) return;
  enabled().then((on) => {
    if (!on) return;
    fetch("/api/app/track", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, page: page ?? (typeof location !== "undefined" ? location.pathname : "") }),
      keepalive: true, // 페이지 이탈 중에도 전송 시도
    }).then((r) => {
      if (r.status === 401) authMutedUntil = Date.now() + 5 * 60_000; // 로그인하면 5분 내 자동 재개
    }).catch(() => {});
  }).catch(() => {});
}
