import { useEffect, useState } from "react";
import Section from "../common/Section";
import { api, ApiError, type DirectoryUser } from "../../lib/api";
import PagedList from "../common/PagedList";
import DataTable from "../common/DataTable";
import SearchInput from "../common/SearchInput";
import styles from "../../styles/Admin.module.css";

/** 관리자 · 사용자 목록(docs/29 §4, flag user_directory).
 * 🔒 개인정보 경계: '누구인지'까지만 — 이메일(=ID)·가입일·마지막 활동·채팅 수·인증/관리자 여부.
 * 타인 채팅 본문을 읽는 기능은 없다(P2.5 원칙 ⓐ 불변).
 * 가입 승인/거절(docs/36 §10): 관리자 승인제(메일 서버 불가 시) — 대기 계정을 여기서 활성/삭제. */
export default function AdminUsers() {
  const [rows, setRows] = useState<DirectoryUser[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [kw, setKw] = useState("");
  const [seg, setSeg] = useState<"real" | "test" | "all">("real"); // 기본 = 실사용자(운영 지표)

  const load = () =>
    api.listUsers()
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "불러오기에 실패했습니다."));
  useEffect(() => { load(); }, []);

  const act = async (id: number, kind: "approve" | "reject") => {
    if (busy) return;
    if (kind === "reject" && !window.confirm("이 가입 신청을 거절(삭제)할까요?")) return;
    setBusy(id);
    setErr("");
    try {
      await (kind === "approve" ? api.approveUser(id) : api.rejectUser(id));
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "처리에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  // ── 실사용자 / 테스트 계정 분리(사용자 지시 2026-07-28) ──
  // 개발·검증 과정에서 만든 계정이 실사용 지표를 가린다(실측: 23명 중 실계정 5명).
  // ⛔ 계정을 지우거나 데이터를 바꾸지 않는다 — **표시 분류**만(휴리스틱이라 오분류 여지 있음).
  //   테스트로 보는 것: ⓐ 사내 도메인이 아닌 아이디(로컬 이름·숫자만) ⓑ 이름에 테스트 토큰 포함.
  const isTestAccount = (name: string) => {
    const u = (name || "").toLowerCase();
    if (!u.includes("@kei.re.kr")) return true;                 // 사내 이메일이 아니면 검증용
    return /test|probe|check|badge|dummy|sample|auto|temp/.test(u);
  };

  const fmt = (t: number | null) => {
    if (!t) return "—";
    const d = new Date(t * 1000);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  if (err && !rows) return <div className={styles.err}>{err}</div>;
  if (!rows) return <div className={styles.muted}>불러오는 중…</div>;

  const pending = rows.filter((u) => !u.verified).length;
  // 검색(아이디) + 최신 가입순 — 표시·페이지는 PagedList(컨트롤 상단) 공통 골격
  const nReal = rows.filter((u) => !isTestAccount(u.username)).length;
  const nTest = rows.length - nReal;
  const filtered = rows
    .filter((u) => (seg === "all" ? true : seg === "real" ? !isTestAccount(u.username) : isTestAccount(u.username)))
    .filter((u) => !kw || u.username.toLowerCase().includes(kw.toLowerCase()))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return (
    <Section icon="👥" title="사용자" badge={pending || undefined}
      desc={<>실사용자 {nReal}명 · 테스트 {nTest}명{pending > 0 ? ` · ⏳ 승인 대기 ${pending}명` : ""} · 🔒 목록·활동 메타만 표시됩니다 — 사용자의 채팅 내용은 관리자도 볼 수 없습니다.</>}>
      {err ? <div className={styles.err}>{err}</div> : null}
      <PagedList items={filtered} sizes={[10, 30, 50]} unit="명" note="최신 가입순" resetKey={`${seg}|${kw}`}
        empty="일치하는 사용자가 없어요."
        filterSlot={<>
          <span className={styles.segRow} role="group" aria-label="계정 구분">
            {([["real", `실사용자 ${nReal}`], ["test", `테스트 ${nTest}`], ["all", `전체 ${rows.length}`]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={seg === k}
                className={seg === k ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
                title={k === "test" ? "사내 이메일이 아니거나 이름에 test·probe 등이 든 계정 — 개발·검증용" : undefined}
                onClick={() => setSeg(k)}>{label}</button>
            ))}
          </span>
          <span style={{ maxWidth: 240, flex: 1 }}>
            <SearchInput value={kw} onChange={(e) => setKw(e.target.value)} onClear={() => setKw("")}
              placeholder="아이디 검색" ariaLabel="사용자 아이디 검색" />
          </span>
        </>}>
        {(paged) => (
      <DataTable
        rows={paged}
        rowKey={(u) => String(u.id)}
        cols={[
          { key: "id", head: "아이디(이메일)", wrap: true, render: (u) => (<>{u.username}
            {u.is_admin ? <span className={styles.badgeAdmin}> 관리자</span> : null}
            {isTestAccount(u.username) ? <span className={styles.badgeTest} title="개발·검증용으로 분류된 계정">테스트</span> : null}</>) },
          { key: "created", head: "가입일", render: (u) => fmt(u.created_at) },
          { key: "active", head: "마지막 활동", render: (u) => fmt(u.last_active) },
          { key: "chats", head: "채팅 수", num: true, render: (u) => u.chats },
          { key: "state", head: "상태", render: (u) => (u.verified ? "✅ 인증됨" : "⏳ 승인 대기") },
          { key: "act", head: "가입 승인", render: (u) => (
            u.verified ? <span className={styles.muted}>—</span> : (
              <span className={styles.rowActions}>
                <button className={styles.approveBtn} disabled={busy === u.id} onClick={() => act(u.id, "approve")}>승인</button>
                <button className={styles.rejectBtn} disabled={busy === u.id} onClick={() => act(u.id, "reject")}>거절</button>
              </span>
            )) },
        ]}
      />
        )}
      </PagedList>
    </Section>
  );
}
