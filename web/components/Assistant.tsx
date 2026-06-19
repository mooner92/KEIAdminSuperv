import { useEffect, useState } from "react";
import { api, type User } from "../lib/api";
import Login from "./Login";
import ChatApp from "./ChatApp";
import type { DocMeta } from "../lib/vault";
import styles from "./Assistant.module.css";

/** 인증 게이트: 세션 확인 → 미로그인이면 Login, 로그인 상태면 ChatApp. (클라이언트 렌더) */
export default function Assistant({ docs }: { docs: DocMeta[] }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className={styles.loading}>불러오는 중…</div>;
  if (!user) return <Login onAuthed={setUser} />;

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
  };

  return <ChatApp user={user} docs={docs} onLogout={logout} />;
}
