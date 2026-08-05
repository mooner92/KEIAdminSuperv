import { useCallback, useEffect, useState } from "react";
import { api, type AmendItem, type AmendLogRow, type AmendView } from "../../lib/api";
import Section from "../common/Section";
import s from "./AmendPanel.module.css";

/** 개정 반영 패널(specs/15 §9) — 신·구조문 대비표는 '승인'이 아니라 **한 줄씩 전사**한다.
 *
 * 왜 승인 버튼이 없나: 개정안에는 규정 본문이 '생략/좌동'으로만 적혀 있다. 그대로 편입하면
 * 같은 규정의 두 판본이 색인되고, 교체하면 원문이 요약본으로 덮인다(⛔절대규칙 1).
 *
 * ⛔ 이 화면은 스스로 판단하지 않는다. 반영 가능 여부·줄 번호·앵커는 전부 서버 판정이고,
 *    화면은 그것을 **이유까지 그대로** 보여준다 — 버튼을 조용히 감추면 사람이 누락으로 오해한다.
 */
export default function AmendPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [v, setV] = useState<AmendView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<AmendLogRow[]>([]);
  const [note, setNote] = useState("");

  const load = useCallback((doc = "") => {
    api.amendPreview(id, doc)
      .then((r) => { setV(r); setErr(""); })
      .catch((e) => setErr(e instanceof Error ? e.message : "미리보기 실패"));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  const loadLog = () => api.amendLog(30).then((r) => setLog(r.log)).catch(() => {});

  const apply = async (it: AmendItem) => {
    if (!v?.대상) return;
    setBusy(it.개정줄);
    try {
      const r = await api.amendApply(id, v.대상, it.개정줄, it.현행줄);
      setV(r);                                  // 서버 재계산본으로 교체 — 화면이 항상 현재 문서를 본다
      setNote(r.결과.already ? "이미 반영된 내용이었습니다(문서 변경 없음)."
        : r.결과.ok ? `반영했습니다. 백업: ${r.결과.backup ?? "-"}`
          : `반영하지 못했습니다 — ${r.결과.detail || r.결과.reason || "사유 미상"}`);
      loadLog();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "반영 실패");
    } finally { setBusy(""); }
  };

  if (err) return <Section icon="📋" title="개정 반영"><p className={s.err}>{err}</p></Section>;
  if (!v) return <Section icon="📋" title="개정 반영"><p className={s.dim}>불러오는 중…</p></Section>;

  const a = v.개정안;
  return (
    <Section
      icon="📋"
      title="개정 반영 — 신·구조문 대비표"
      actions={<button className={s.close} onClick={onClose}>✕ 닫기</button>}
      desc={<>이 파일은 <b>규정 전문이 아니라 개정안</b>입니다. 본문이 &apos;생략·좌동&apos;으로만 적혀 있어
        그대로 편입·교체하면 기존 조문이 사라집니다. 아래에서 <b>확정된 줄만 한 건씩</b> 반영하세요
        (백업·검수상태 되돌림은 자동, ⛔일괄 반영 없음).</>}>

      <div className={s.head}>
        <b className={s.title}>{a?.제목 || v.name}</b>
        {a?.시행일 ? <span className={s.chip}>시행일 {a.시행일}</span> : null}
        <label className={s.target}>
          대상 문서
          <select value={v.대상 || ""} onChange={(e) => load(e.target.value)}
            aria-label="반영할 대상 문서">
            {(v.후보 || []).map((c) => (
              <option key={c.path} value={c.path}>{c.규정명} — {c.path}</option>
            ))}
            {v.대상 && !(v.후보 || []).some((c) => c.path === v.대상)
              ? <option value={v.대상}>{v.대상}</option> : null}
          </select>
        </label>
      </div>
      {a?.개정이유?.length ? (
        <ul className={s.reasons}>{a.개정이유.map((r, i) => <li key={i}>{r}</li>)}</ul>
      ) : null}
      {note ? <p className={s.note} role="status">{note}</p> : null}

      {!v.대상 ? (
        <p className={s.err}>대상 문서를 찾지 못했습니다 — 개정안은 기존 규정이 있어야 반영할 수 있습니다.</p>
      ) : (v.제안 || []).length === 0 ? (
        <p className={s.err}>
          이 문서에서 대비표를 찾지 못했습니다 — &apos;현행/개정(안)&apos; 형식이 아니거나
          지원하지 않는 표 구조일 수 있습니다. 반영 버튼을 만들 수 없으니, 원문을 직접 열어
          확인·반영해 주세요.
        </p>
      ) : (v.제안 || []).map((row) => (
        <div key={row.행} className={s.row}>
          <div className={s.rowHead}>
            <b>[{row.행}] {row.종류}</b>
            {row.비고 ? <span className={s.memo}>{row.비고}</span> : null}
          </div>
          {row.경고.map((w, i) => <p key={i} className={s.warn}>⚠ {w}</p>)}
          {row.변경.length === 0 ? <p className={s.dim}>반영할 변경 없음</p> : null}
          {row.변경.map((it, i) => (
            <div key={i} className={s.item}>
              <div className={s.diff}>
                {it.현행줄 ? <p className={s.minus}>− {it.현행줄}</p> : null}
                {it.개정줄 ? <p className={s.plus}>＋ {it.개정줄}</p> : null}
              </div>
              <div className={s.side}>
                <span className={s.loc}>
                  {(it.모드 === "replace" || it.모드 === "cell") && it.볼트줄 ? `${it.볼트줄}줄`
                    : it.모드 === "insert" && it.앵커줄 ? `${it.앵커줄}줄 뒤`
                      : it.모드 === "append" ? "문서 끝" : it.상태 || "—"}
                </span>
                {it.반영가능 ? (
                  <button className={s.apply} disabled={!!busy} onClick={() => apply(it)}>
                    {busy === it.개정줄 ? "반영 중…"
                      : it.모드 === "append" ? "블록 반영" : it.모드 === "cell" ? "이 값 반영" : "이 줄 반영"}
                  </button>
                ) : it.이미반영 ? (
                  <span className={s.done}>✅ 이미 반영됨</span>
                ) : <span className={s.locked} title={it.불가사유}>🔒 반영 불가</span>}
              </div>
              {!it.반영가능 && !it.이미반영 ? <p className={s.why}>{it.불가사유}</p> : null}
            </div>
          ))}
        </div>
      ))}

      {/* 반영 후 해야 할 일 — 한 줄 고쳤다고 끝이 아니다(specs/15 §10) */}
      <p className={s.after}>
        <b>반영 후:</b> ⟳ <b>재색인</b>으로 검색에 반영하세요. 위임전결규정처럼 <b>별표(전결 매트릭스)</b>가
        걸린 규정은 본문 줄 반영만으로 <code>approval.json</code>이 갱신되지 않습니다 —
        <code>01n_approval.py</code>를 다시 돌려야 결재선 화면이 맞습니다.
      </p>

      <details className={s.logBox} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadLog(); }}>
        <summary>📜 반영 로그 (거부 사유 포함)</summary>
        {log.length === 0 ? <p className={s.dim}>기록 없음</p> : (
          <ul className={s.logList}>
            {log.map((r, i) => (
              <li key={i} className={r.event === "amend_apply" ? s.logOk : s.logNo}>
                <span className={s.logTs}>{r.ts}</span>
                <span className={s.logEv}>{r.event}</span>
                <span>{r.target?.split("/").pop()}{r.line ? ` :${r.line}` : ""}</span>
                <span className={s.logTxt}>{r.after || r.detail || r.reason || ""}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Section>
  );
}
