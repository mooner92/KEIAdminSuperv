import { useEffect, useState } from "react";
import { api, type ChangelogDraft } from "../../lib/api";
import Section from "../common/Section";
import styles from "../../styles/Admin.module.css";

/** 개정 반영 → 패치노트 초안(2026-08-05, 운영자 요청) — 재색인 성공 후 자동으로 쓰인다.
 * ⛔ 자동 게시 없음 — `상태: 초안`이 붙은 채로만 존재하고(사이트는 걸러냄), 관리자가
 *   내용을 읽고 이 화면에서 명시적으로 게시해야 사용자에게 보인다. */
export default function ChangelogDrafts() {
  const [drafts, setDrafts] = useState<ChangelogDraft[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const load = () => api.changelogDrafts().then((r) => setDrafts(r.drafts)).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!drafts.length) return null;   // 초안이 없으면 섹션 자체를 안 보여준다(빈 상자 금지)

  const publish = async (d: ChangelogDraft) => {
    setBusy(d.path);
    try {
      const r = await api.publishChangelogDraft(d.path);
      setNote(r.message);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "게시 실패");
    } finally { setBusy(""); }
  };

  return (
    <Section icon="📝" title={`패치노트 초안 (${drafts.length}건 검토 대기)`}
      desc="재색인 후 반영된 개정 내용을 바탕으로 자동으로 초안이 쓰였어요. 읽어보고 게시하면 사용자에게 보여요(⛔게시 전에는 아무도 못 봅니다).">
      {note ? <p className={styles.pendWarn} role="status">{note}</p> : null}
      <ul className={styles.pendList}>
        {drafts.map((d) => (
          <li key={d.path} className={styles.pendRow} style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
            <div><b>{d.제목}</b> <span className={styles.pendWarn}>· {d.분류} · {d.날짜}</span></div>
            <div style={{ fontSize: 12.5, opacity: .85, whiteSpace: "pre-wrap" }}>{d.body}</div>
            <span className={styles.pendBtns}>
              <button disabled={!!busy} onClick={() => publish(d)}>
                {busy === d.path ? "게시 중…" : "✅ 게시"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
