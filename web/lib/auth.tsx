// 공유 인증 상태(docs/36) — 로그인/로그아웃이 앱 전역(특히 Layout의 GNB)에 즉시 반영되도록
// 단일 출처로 관리한다. 이전엔 Assistant(setUser)와 Layout(자체 me())이 인증 상태를 각자 들고 있어
// 로그인/로그아웃 후 상단 메뉴가 새로고침 전까지 갱신되지 않는 버그가 있었다.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "./api";
import { setTrackAuthed } from "./track";

type AuthCtx = {
  user: User | null;
  ready: boolean; // 최초 me() 확인 완료 여부(SSG→CSR 게이트)
  setUser: (u: User | null) => void; // 로그인 성공 시 호출
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  setUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // 상태 반영 공통 — track 인증 힌트도 여기서 단일 갱신(비로그인 401 뮤트 부작용 방지, docs/36 §6⑦)
  const apply = useCallback((u: User | null) => {
    setUserState(u);
    setTrackAuthed(!!u);
  }, []);

  useEffect(() => {
    api.me().then(apply).catch(() => apply(null)).finally(() => setReady(true));
    // 탭 복귀/포커스 시 세션 조용히 재검증 — 다른 탭 로그아웃·중간 만료 반영(공유 PC 대비, 리뷰 확정).
    // ⚠ 401(명시적 만료)에만 로그아웃 처리 — 네트워크 블립으로 사용자를 튕기지 않는다.
    const revalidate = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      api.me()
        .then(apply)
        .catch((e) => { if (e instanceof ApiError && e.status === 401) apply(null); });
    };
    window.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      window.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [apply]);

  const logout = useCallback(async () => {
    try {
      await api.logout();  // 서버 세션 쿠키 무효화(fail-closed)
    } catch {
      // 무효화 실패해도 진행 — 아래 하드 이동이 서버 게이트 재검을 강제한다.
    }
    apply(null);
    // ⛔ SPA 라우팅(router.push)이 아니라 하드 이동 — 이미 렌더된 보호 페이지가 로그아웃 후에도
    // 남아 기능이 쓰이던 문제(사용자 제보). location.replace로 ① 전체 재로드 → server.js 로그인
    // 게이트가 쿠키 부재를 재확인해 랜딩 셸만 서빙 ② 히스토리 교체 → 뒤로가기해도 보호 페이지로
    // 못 돌아감(게이트가 다시 막음). 캐시된 정적 페이지도 게이트 뒤라 콘텐츠는 재요청돼야 뜬다.
    if (typeof window !== "undefined") window.location.replace("/");
  }, [apply]);

  return <Ctx.Provider value={{ user, ready, setUser: apply, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
