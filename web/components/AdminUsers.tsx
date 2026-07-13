import { useEffect, useState } from "react";
import { api, ApiError, type DirectoryUser } from "../lib/api";
import styles from "../styles/Admin.module.css";

/** 관리자 · 사용자 목록(docs/29 §4, flag user_directory).
 * 🔒 개인정보 경계: '누구인지'까지만 — 이메일(=ID)·가입일·마지막 활동·채팅 수·인증/관리자 여부.
 * 타인 채팅 본문을 읽는 기능은 없다(P2.5 원칙 ⓐ 불변). */
export default function AdminUsers() {
  const [rows, setRows] = useState<DirectoryUser[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listUsers()
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "불러오기에 실패했습니다."));
  }, []);

  const fmt = (t: number | null) => {
    if (!t) return "—";
    const d = new Date(t * 1000);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  if (err) return <div className={styles.err}>{err}</div>;
  if (!rows) return <div className={styles.muted}>불러오는 중…</div>;

  return (
    <section aria-label="사용자 목록">
      <p className={styles.muted}>
        총 {rows.length}명 · 🔒 목록·활동 메타만 표시됩니다 — 사용자의 채팅 내용은 관리자도 볼 수 없습니다.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>아이디(이메일)</th>
              <th>가입일</th>
              <th>마지막 활동</th>
              <th>채팅 수</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.is_admin ? <span className={styles.badgeAdmin}> 관리자</span> : null}
                </td>
                <td>{fmt(u.created_at)}</td>
                <td>{fmt(u.last_active)}</td>
                <td>{u.chats}</td>
                <td>{u.verified ? "✅ 인증됨" : "⏳ 인증 대기"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
