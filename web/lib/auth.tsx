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
      await api.logout();
    } catch {
      // 서버 세션 무효화 실패(네트워크·오류) — 클라이언트만 로그아웃하면 쿠키가 남아 새로고침 시
      // 재로그인될 수 있다(공유 PC 위험). 하드 리로드로 서버에 세션 상태를 재확인시킨다.
      apply(null);
      if (typeof window !== "undefined") window.location.reload();
      return;
    }
    apply(null);
  }, [apply]);

  return <Ctx.Provider value={{ user, ready, setUser: apply, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
