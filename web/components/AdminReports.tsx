import { useCallback, useEffect, useState } from "react";
import { api, type ReportRow, type MaintNoticeRow } from "../lib/api";
import Markdown from "./Markdown";
import styles from "../styles/Admin.module.css";
import f from "../styles/Feedback.module.css";

// 📮 의견함(docs/51 §7) — ⓐ🔔 유지보수 알림(분석기 계획 생성 시) ⓑ최신 계획안 md
// ⓒ접수함(상태 처리·메모). ⛔ 분석기는 계획·알림만 — 여기서의 상태 변경(계획반영 등)은 사람(관리자).
const STATES = ["접수", "분석됨", "중복", "계획반영", "처리완료", "보류"] as const;
const ADMIN_SET = ["접수", "계획반영", "처리완료", "보류"]; // 관리자가 지정 가능(분석됨/중복=분석기 전용)

export default function AdminReports() {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [notices, setNotices] = useState<{ unread: number; notices: MaintNoticeRow[] } | null>(null);
  const [plan, setPlan] = useState<{ name: string; md: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.allReports(filter || undefined).then(setReports).catch(() => setReports([]));
    api.maintNotices().then(setNotices).catch(() => {});
    api.maintPlanLatest().then(setPlan).catch(() => setPlan(null)); // 404 = 아직 계획 없음
  }, [filter]);
  useEffect(load, [load]);

  const setState = async (id: number, 상태: string) => {
    try {
      await api.patchReport(id, { 상태 });
      setMsg(`#${id} → ${상태}`);
      load();
    } catch {
      setMsg("상태 변경 실패");
    }
  };
  const saveNote = async (id: number) => {
    try {
      await api.patchReport(id, { admin_note: noteDraft[id] ?? "" });
      setMsg(`#${id} 메모 저장`);
      load();
    } catch {
      setMsg("메모 저장 실패");
    }
  };
  const readAll = async () => {
    await api.maintNoticesRead().catch(() => {});
    load();
  };

  return (
    <section>
      <h2 className={styles.h2}>
        🔔 유지보수 알림
        {notices && notices.unread > 0 ? <span className={f.unreadBadge}> {notices.unread}</span> : null}
      </h2>
      <p className={styles.muted}>
        매시간 로컬 모델이 접수 제보를 분석해 계획을 만들면 여기에 알림이 옵니다(신규 없으면 알림 없음 — 실행 기록만 남음).
      </p>
      {notices && notices.notices.length > 0 ? (
        <div className={f.noticeList}>
          {notices.notices.slice(0, 8).map((n) => (
            <div key={n.id} className={f.noticeRow} data-unread={n.unread}>
              <span>{n.unread ? "🔵" : "⚪"} {n.summary}</span>
              <time>{new Date(n.at * 1000).toLocaleString("ko-KR")}</time>
            </div>
          ))}
          {notices.unread > 0 ? (
            <button className={f.readAll} onClick={readAll}>모두 읽음</button>
          ) : null}
        </div>
      ) : (
        <p className={styles.muted}>알림이 없습니다.</p>
      )}

      <h2 className={styles.h2}>🗓 최신 유지보수 계획안</h2>
      {plan ? (
        <div className={f.planBox}>
          <button className={f.planToggle} onClick={() => setPlanOpen(!planOpen)}>
            {planOpen ? "▾" : "▸"} {plan.name}
          </button>
          {planOpen ? <div className={f.planMd}><Markdown source={plan.md} /></div> : null}
        </div>
      ) : (
        <p className={styles.muted}>아직 생성된 계획이 없습니다.</p>
      )}

      <h2 className={styles.h2}>📮 접수함</h2>
      <div className={f.filterRow}>
        <button className={`${f.typeChip} ${filter === "" ? f.typeOn : ""}`} onClick={() => setFilter("")}>전체</button>
        {STATES.map((s) => (
          <button key={s} className={`${f.typeChip} ${filter === s ? f.typeOn : ""}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
        {msg ? <span className={f.adminMsg} role="status">{msg}</span> : null}
      </div>
      {reports === null ? <p className={styles.muted}>불러오는 중…</p> : null}
      {reports !== null && reports.length === 0 ? <p className={styles.muted}>제보가 없습니다.</p> : null}
      {(reports || []).map((r) => (
        <article key={r.id} className={f.mineCard}>
          <header className={f.mineHead}>
            <b>#{r.id}</b>
            <span className={f.mineType}>{r.유형}</span>
            {r.대상규정 ? <span className={f.mineDoc}>{r.대상규정}{r.대상조문 ? ` · ${r.대상조문}` : ""}</span> : null}
            <span className={f.mineDoc}>{r.제보자}</span>
            {r.group ? <span className={f.mineDoc} title="분석 그룹">{r.group}</span> : null}
            <select className={f.stateSel} value={r.상태} onChange={(e) => setState(r.id, e.target.value)}
              aria-label={`#${r.id} 상태 변경`}>
              {(ADMIN_SET.includes(r.상태) ? ADMIN_SET : [r.상태, ...ADMIN_SET]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <time className={f.mineDate}>{new Date(r.at * 1000).toLocaleDateString("ko-KR")}</time>
          </header>
          <p className={f.mineBody}>{r.내용}</p>
          <div className={f.noteRow}>
            <input className={f.input} placeholder="처리 메모(제보자에게 보임)"
              value={noteDraft[r.id] ?? r.admin_note}
              onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })} />
            <button className={f.readAll} onClick={() => saveNote(r.id)}>저장</button>
          </div>
        </article>
      ))}
    </section>
  );
}
