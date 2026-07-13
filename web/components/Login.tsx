import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import styles from "./Login.module.css";

/** 로그인 / 회원가입 — 사내 전용. 성공 시 onAuthed(user).
 * 가입 정책(docs/29 §3): ID = KEI 이메일(@kei.re.kr) 고정, 6자리 코드 인증 후 활성.
 * 흐름: register(이메일+비번) → 코드 입력 단계 → verify 성공 시 로그인. */
export default function Login({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "verify">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState(""); // 안내(코드 발송됨 등)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : "연결에 실패했습니다.");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        onAuthed(await api.login(username, password));
      } else if (mode === "register") {
        const r = await api.register(username, password);
        setMode("verify");
        setInfo(
          r.dev_code
            ? `개발 모드 — 인증 코드: ${r.dev_code}`
            : `${r.email} 로 인증 코드를 보냈습니다. 메일함을 확인하세요.`
        );
      } else {
        onAuthed(await api.verifyEmail(username, code));
      }
    } catch (e) {
      // 미인증 계정 로그인 → 코드 단계로 안내(재발송 버튼 제공)
      if (mode === "login" && e instanceof ApiError && e.status === 403) {
        setMode("verify");
        setInfo("이메일 인증이 완료되지 않은 계정입니다. 코드를 입력하거나 재발송하세요.");
      } else fail(e);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.resendCode(username, password);
      setInfo(r.dev_code ? `개발 모드 — 인증 코드: ${r.dev_code}` : `${r.email} 로 코드를 다시 보냈습니다.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark}>KEI</span> 행정 LLM
        </div>
        <h1 className={styles.title}>
          {mode === "login" ? "로그인" : mode === "register" ? "회원가입" : "이메일 인증"}
        </h1>
        <p className={styles.lead}>
          {mode === "verify"
            ? "메일로 받은 6자리 인증 코드를 입력하면 가입이 완료됩니다."
            : "사내 규정을 근거로 답하는 행정 LLM입니다. 채팅 기록은 계정별로 안전하게 보관됩니다."}
        </p>

        <form onSubmit={submit} className={styles.form}>
          {mode !== "verify" ? (
            <>
              <label className={styles.field}>
                <span>{mode === "register" ? "KEI 이메일 (아이디)" : "아이디 (이메일)"}</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={mode === "register" ? "name@kei.re.kr" : "name@kei.re.kr"}
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
            </>
          ) : (
            <label className={styles.field}>
              <span>인증 코드 (6자리)</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                autoFocus
              />
            </label>
          )}

          {info ? <div className={styles.note}>{info}</div> : null}
          {err ? <div className={styles.err}>{err}</div> : null}

          <button
            type="submit"
            className={styles.submit}
            disabled={busy || (mode === "verify" ? code.length !== 6 : !username || !password)}
          >
            {busy ? "처리 중…" : mode === "login" ? "로그인" : mode === "register" ? "인증 코드 받기" : "인증하고 시작"}
          </button>
          {mode === "verify" ? (
            <button type="button" className={styles.resend} onClick={resend} disabled={busy}>
              코드 재발송
            </button>
          ) : null}
        </form>

        <div className={styles.switch}>
          {mode === "login" ? (
            <>
              계정이 없나요?{" "}
              <button onClick={() => { setMode("register"); setErr(""); setInfo(""); }}>회원가입</button>
            </>
          ) : (
            <>
              이미 계정이 있나요?{" "}
              <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }}>로그인</button>
            </>
          )}
        </div>
        {mode === "register" ? (
          <p className={styles.note}>🏢 가입은 KEI 임직원 이메일(@kei.re.kr)로만 가능합니다.</p>
        ) : null}
        <p className={styles.note}>🔒 내부 전용 · 입력 정보는 사내 서버에만 저장됩니다.</p>
        <p className={styles.note}>비밀번호를 잊으셨나요? 시스템 관리자에게 재설정을 요청하세요.</p>
      </div>
    </div>
  );
}
