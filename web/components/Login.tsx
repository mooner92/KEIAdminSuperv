import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import { track, setTrackAuthed } from "../lib/track";
import { useFlag } from "../lib/flags";
import styles from "./Login.module.css";

/** 로그인 / 회원가입 — 사내 전용. 성공 시 onAuthed(user).
 * 가입 정책(docs/29 §3): ID = KEI 이메일(@kei.re.kr) 고정, 6자리 코드 인증 후 활성.
 * 흐름: register(이메일+비번) → 코드 입력 단계 → verify 성공 시 로그인.
 * embedded(docs/36): 랜딩 섹션에 카드로 임베드 — autoFocus 금지(로드 즉시 최하단 점프 방지). */
export default function Login({ onAuthed, embedded }: { onAuthed: (u: User) => void; embedded?: boolean }) {
  const approval = useFlag("signup_approval"); // 관리자 승인제(docs/36 §10) — 이메일 코드 대신 승인 대기
  const [mode, setMode] = useState<"login" | "register" | "verify" | "pending">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState(""); // 안내(코드 발송됨 등)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : "연결에 실패했습니다.");

  // 인증 성공 공통 — track 인증 힌트 갱신(비로그인 뮤트 해제) + 랜딩 경유 로그인 1회 계측(docs/36 §6⑦)
  const authed = (u: User) => {
    setTrackAuthed(true);
    if (embedded) track("login_via_landing");
    onAuthed(u);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        authed(await api.login(username, password));
      } else if (mode === "register") {
        const r = await api.register(username, password);
        if (r.pending_approval) {
          // 관리자 승인제: 코드 단계 없이 '승인 대기' 안내
          setMode("pending");
          setInfo(`${r.email} 가입 신청이 접수됐어요. 관리자 승인 후 로그인할 수 있습니다.`);
        } else {
          setMode("verify");
          setInfo(
            r.dev_code
              ? `개발 모드 — 인증 코드: ${r.dev_code}`
              : `${r.email} 로 인증 코드를 보냈습니다. 메일함을 확인하세요.`
          );
        }
      } else {
        authed(await api.verifyEmail(username, code));
      }
    } catch (e) {
      // 미인증 계정 로그인 → 승인제면 안내만, 코드제면 코드 단계로
      if (mode === "login" && e instanceof ApiError && e.status === 403) {
        if (approval) {
          setErr(e.message); // "관리자 승인 대기 중입니다. 승인되면 로그인할 수 있어요."
        } else {
          setMode("verify");
          setInfo("이메일 인증이 완료되지 않은 계정입니다. 코드를 입력하거나 재발송하세요.");
        }
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
    <div className={embedded ? styles.wrapEmbedded : styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark}>KEI</span> 행정 LLM
        </div>
        <h1 className={styles.title}>
          {mode === "login" ? "로그인" : mode === "register" ? "회원가입"
            : mode === "pending" ? "가입 신청 접수" : "이메일 인증"}
        </h1>
        <p className={styles.lead}>
          {mode === "verify"
            ? "메일로 받은 6자리 인증 코드를 입력하면 가입이 완료됩니다."
            : mode === "pending"
            ? "관리자가 확인하고 승인하면 로그인할 수 있어요."
            : "사내 규정을 근거로 답하는 행정 LLM입니다. 채팅 기록은 계정별로 안전하게 보관됩니다."}
        </p>

        {mode === "pending" ? (
          <>
            {info ? <div className={styles.note}>{info}</div> : null}
            <button type="button" className={styles.submit}
              onClick={() => { setMode("login"); setInfo(""); setErr(""); }}>로그인 화면으로</button>
          </>
        ) : (
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
                  autoFocus={!embedded}
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
            {busy ? "처리 중…"
              : mode === "login" ? "로그인"
              : mode === "register" ? (approval ? "가입 신청" : "인증 코드 받기")
              : "인증하고 시작"}
          </button>
          {mode === "verify" ? (
            <button type="button" className={styles.resend} onClick={resend} disabled={busy}>
              코드 재발송
            </button>
          ) : null}
        </form>
        )}

        {mode !== "pending" ? (
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
        ) : null}
        {mode === "register" ? (
          <p className={styles.note}>
            🏢 가입은 KEI 임직원 이메일(@kei.re.kr)로만 가능합니다.
            {approval ? " 신청 후 관리자 승인이 필요합니다." : ""}
          </p>
        ) : null}
        <p className={styles.note}>🔒 내부 전용 · 입력 정보는 사내 서버에만 저장됩니다.</p>
        <p className={styles.note}>비밀번호를 잊으셨나요? 시스템 관리자에게 재설정을 요청하세요.</p>
      </div>
    </div>
  );
}
