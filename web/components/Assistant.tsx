import { useEffect, useState } from "react";
import AsyncState from "./common/AsyncState";
import Login from "./Login";
import Landing from "./Landing";
import ChatApp from "./ChatApp";
import { useFlag, useFlagsSettled } from "../lib/flags";
import { useAuth } from "../lib/auth";
import type { DocMeta } from "../lib/vault";
import type { LandingCounts } from "./Landing";
import type { JourneyChip } from "../lib/api";

/** 인증 게이트: 공유 AuthContext(useAuth) 기준 — 미로그인이면 랜딩(flag landing_page) 또는 Login,
 * 로그인 상태면 ChatApp. 로그인/로그아웃이 AuthContext를 갱신하므로 Layout의 GNB도 즉시 반영된다.
 * 비로그인 첫 화면은 flag 값에 따라 갈리므로 flags fetch가 settle될 때까지 대기(Login 플래시 방지). */
export default function Assistant({ counts, journeys }: { counts?: LandingCounts; journeys?: JourneyChip[] }) {
  const { user, ready, setUser, logout } = useAuth();
  const landingOn = useFlag("landing_page");
  const flagsSettled = useFlagsSettled();

  // 문서 목록은 **로그인 뒤에** 받는다 — 랜딩 props로 실으면 비로그인에게 588건이
  // 그대로 나간다(2차 스캔 F3, docs/65 §5). /docs-index.json은 게이트 허용목록에 없어
  // 세션 없이는 302로 막힌다. 실패해도 채팅은 동작한다(근거 링크·검수 배지만 비활성).
  const [docs, setDocs] = useState<DocMeta[]>([]);
  useEffect(() => {
    if (!user) { setDocs([]); return; }
    let alive = true;
    fetch("/docs-index.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive && Array.isArray(d)) setDocs(d as DocMeta[]); })
      .catch(() => { /* 목록 없이도 채팅은 정상 — 링크만 안 걸린다 */ });
    return () => { alive = false; };
  }, [user]);

  if (!ready || (!user && !flagsSettled)) return <AsyncState loading loadingText="사용자 확인 중…" />;
  if (!user) return landingOn ? <Landing variant="home" counts={counts} onAuthed={setUser} /> : <Login onAuthed={setUser} />;

  return <ChatApp user={user} docs={docs} journeys={journeys} onLogout={logout} />;
}
