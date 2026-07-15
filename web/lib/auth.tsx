// 공유 인증 상태(docs/36) — 로그인/로그아웃이 앱 전역(특히 Layout의 GNB)에 즉시 반영되도록
// 단일 출처로 관리한다. 이전엔 Assistant(setUser)와 Layout(자체 me())이 인증 상태를 각자 들고 있어
// 로그인/로그아웃 후 상단 메뉴가 새로고침 전까지 갱신되지 않는 버그가 있었다.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";
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
  }, [apply]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* 네트워크 실패라도 클라이언트 상태는 로그아웃 처리 */
    }
    apply(null);
  }, [apply]);

  return <Ctx.Provider value={{ user, ready, setUser: apply, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
