import AsyncState from "./common/AsyncState";
import Login from "./Login";
import Landing from "./Landing";
import ChatApp from "./ChatApp";
import { useFlag, useFlagsSettled } from "../lib/flags";
import { useAuth } from "../lib/auth";
import type { DocMeta } from "../lib/vault";
import type { LandingCounts } from "./Landing";

/** 인증 게이트: 공유 AuthContext(useAuth) 기준 — 미로그인이면 랜딩(flag landing_page) 또는 Login,
 * 로그인 상태면 ChatApp. 로그인/로그아웃이 AuthContext를 갱신하므로 Layout의 GNB도 즉시 반영된다.
 * 비로그인 첫 화면은 flag 값에 따라 갈리므로 flags fetch가 settle될 때까지 대기(Login 플래시 방지). */
export default function Assistant({ docs, counts }: { docs: DocMeta[]; counts?: LandingCounts }) {
  const { user, ready, setUser, logout } = useAuth();
  const landingOn = useFlag("landing_page");
  const flagsSettled = useFlagsSettled();

  if (!ready || (!user && !flagsSettled)) return <AsyncState loading loadingText="사용자 확인 중…" />;
  if (!user) return landingOn ? <Landing variant="home" counts={counts} onAuthed={setUser} /> : <Login onAuthed={setUser} />;

  return <ChatApp user={user} docs={docs} onLogout={logout} />;
}
