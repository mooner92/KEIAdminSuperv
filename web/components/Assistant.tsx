import { useEffect, useState } from "react";
import AsyncState from "./AsyncState";
import { api, type User } from "../lib/api";
import Login from "./Login";
import Landing from "./Landing";
import ChatApp from "./ChatApp";
import { useFlag, useFlagsSettled } from "../lib/flags";
import { setTrackAuthed } from "../lib/track";
import type { DocMeta } from "../lib/vault";
import styles from "./Assistant.module.css";

/** 인증 게이트: 세션 확인 → 미로그인이면 랜딩(flag landing_page) 또는 Login, 로그인 상태면 ChatApp.
 * 비로그인 첫 화면은 flag 값에 따라 갈리므로 flags fetch가 settle될 때까지 대기 —
 * 기본값(off)으로 Login을 그렸다가 랜딩으로 교체되는 플래시를 막는다(docs/36 §7, 리뷰 확정). */
export default function Assistant({ docs }: { docs: DocMeta[] }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const landingOn = useFlag("landing_page");
  const flagsSettled = useFlagsSettled();

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const authed = (u: User) => {
    setTrackAuthed(true);
    setUser(u);
  };

  if (!ready || (!user && !flagsSettled)) return <AsyncState loading loadingText="사용자 확인 중…" />;
  if (!user) return landingOn ? <Landing variant="home" onAuthed={authed} /> : <Login onAuthed={authed} />;

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setTrackAuthed(false);
    setUser(null);
  };

  return <ChatApp user={user} docs={docs} onLogout={logout} />;
}
