import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import styles from "./Login.module.css";

/** 로그인 / 회원가입 — 사내 전용. 성공 시 onAuthed(user). */
export default function Login({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const u = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onAuthed(u);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "연결에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark}>KEI</span> 행정 비서
        </div>
        <h1 className={styles.title}>{mode === "login" ? "로그인" : "회원가입"}</h1>
        <p className={styles.lead}>
          사내 규정을 근거로 답하는 행정 비서입니다. 채팅 기록은 계정별로 안전하게 보관됩니다.
        </p>

        <form onSubmit={submit} className={styles.form}>
          <label className={styles.field}>
            <span>아이디</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="사번 또는 아이디"
              autoFocus
            />
          </label>
          <label className={styles.field}>
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="비밀번호"
            />
          </label>

          {err ? <div className={styles.err}>{err}</div> : null}

          <button type="submit" className={styles.submit} disabled={busy || !username || !password}>
            {busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하고 시작"}
          </button>
        </form>

        <div className={styles.switch}>
          {mode === "login" ? (
            <>
              계정이 없나요?{" "}
              <button onClick={() => { setMode("register"); setErr(""); }}>회원가입</button>
            </>
          ) : (
            <>
              이미 계정이 있나요?{" "}
              <button onClick={() => { setMode("login"); setErr(""); }}>로그인</button>
            </>
          )}
        </div>
        <p className={styles.note}>🔒 내부 전용 · 입력 정보는 사내 서버에만 저장됩니다.</p>
      </div>
    </div>
  );
}
