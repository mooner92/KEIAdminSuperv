import { useCallback, useEffect, useState } from "react";
import { api, type FaqCandidate } from "../../lib/api";
import PagedList from "../common/PagedList";
import Section from "../common/Section";
import styles from "../../styles/Admin.module.css";

/** FAQ 브리지 탭(docs/58 §6) — 자가평가 '검색실패' 오답의 FAQ 후보를 열람하고
 *  [편입]으로 승인(사람의 명시적 행위)해 볼트 10_업무가이드/FAQ/에 기록한다.
 *  ⛔ 자동 편입 없음 · 본문은 질문+원문 인용+[[출처]]만(생성 답변 없음) · 편입 후 재색인 필요. */
export default function AdminFaqBridge() {
  const [cands, setCands] = useState<FaqCandidate[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editQuote, setEditQuote] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [stateF, setStateF] = useState<"대기" | "전체">("대기");

  const load = useCallback(() => {
    api.faqCandidates().then((r) => setCands(r.candidates))
      .catch((e) => setMsg(e instanceof Error ? e.message : "로드 실패"));
  }, []);
  useEffect(load, [load]);

  const toggleOpen = (c: FaqCandidate) => {
    const next = open === c.id ? null : c.id;
    setOpen(next);
    if (next) { setEditQ(c.질문); setEditQuote(c.인용); }
  };

  const apply = async (c: FaqCandidate) => {
    if (!window.confirm(
      `이 후보를 볼트(10_업무가이드/FAQ/)에 FAQ 노트로 편입합니다.\n` +
      `본문은 질문 + 원문 인용 + 출처 링크만 담기며(생성 답변 없음), 검수상태는 '미검수'로 남습니다.\n` +
      `편입 후 '코퍼스 관리 → 재색인'을 해야 검색에 반영됩니다. 계속할까요?`)) return;
    setBusy(c.id);
    try {
      const r = await api.faqApply(c.id, editQ, editQuote);
      setMsg(`✅ 편입: ${r.path} — 코퍼스 탭에서 재색인하세요.`);
      setOpen(null);
      load();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "편입 실패"}`);
    } finally {
      setBusy("");
    }
  };

  const dismiss = async (c: FaqCandidate) => {
    setBusy(c.id);
    try {
      await api.faqDismiss(c.id);
      setMsg(`기각: ${c.질문.slice(0, 30)}…`);
      load();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "기각 실패"}`);
    } finally {
      setBusy("");
    }
  };

  if (!cands) return <p className={styles.lead}>{msg || "불러오는 중…"}</p>;
  const items = cands.filter((c) => (stateF === "대기" ? c.상태 === "pending" : true));
  const STATE: Record<FaqCandidate["상태"], string> = { pending: "⏳ 대기", applied: "✅ 편입됨", dismissed: "✕ 기각" };

  return (
    <Section icon="🌉" title="FAQ 브리지" badge={cands.filter((c) => c.상태 === "pending").length} desc={
      <>매일 자가평가에서 <b>검색이 근거를 못 찾아 틀린 질문</b>의 FAQ 후보입니다. 내용을 확인하고
      [편입]하면 볼트에 <b>질문 + 원문 인용 + 출처 링크</b>만 담긴 FAQ 노트가 생겨, 재색인 후 같은
      질문에서 검색이 근거를 찾게 됩니다. ⛔ 자동 편입 없음 — 편입돼도 검수상태는 미검수로 남습니다.</>
    }>
      {msg ? <p className={styles.restoreMsg}>{msg}</p> : null}
      <PagedList
        items={items}
        unit="건"
        defaultSize={10}
        resetKey={stateF}
        empty={stateF === "대기" ? "대기 중인 FAQ 후보가 없어요 — 검색실패 오답이 생기면 다음 날 아침 여기에 쌓입니다." : "후보가 없어요."}
        filterSlot={
          <span role="tablist" aria-label="상태 필터">
            {(["대기", "전체"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={stateF === f}
                className={`${styles.filtChip} ${stateF === f ? styles.filtOn : ""}`}
                onClick={() => setStateF(f)}>{f}</button>
            ))}
          </span>
        }
      >
        {(paged: FaqCandidate[]) => (
          <ul className={styles.restoreList}>
            {paged.map((c) => {
              const opened = open === c.id;
              return (
                <li key={c.id} className={styles.restoreRow}>
                  <div className={styles.restoreHead} onClick={() => toggleOpen(c)} role="button" aria-expanded={opened}>
                    <b>{c.질문}</b>
                    <span className={styles.muted}> · {c.규정명} {c.조} · {c.date} · {STATE[c.상태]}</span>
                  </div>
                  {opened ? (
                    <div className={styles.restoreBody}>
                      <label className={styles.fieldLabel}>질문(다듬기 가능)</label>
                      <input className={styles.fieldInput} value={editQ} onChange={(e) => setEditQ(e.target.value)} />
                      <label className={styles.fieldLabel}>원문 인용(⛔ 원문 그대로 — 새 문장 작성 금지)</label>
                      <textarea className={styles.fieldInput} rows={3} value={editQuote}
                        onChange={(e) => setEditQuote(e.target.value)} />
                      {c.증거 ? <p className={styles.muted}>오답 증거: {c.증거}</p> : null}
                      <p className={styles.muted}>출처: {c.규정명} {c.조}</p>
                      {c.상태 === "pending" ? (
                        <div className={styles.rowActions}>
                          <button className={styles.applyBtn} disabled={busy === c.id || !editQuote.trim()}
                            onClick={() => apply(c)}>✅ 볼트에 편입</button>
                          <button className={styles.rejectBtn} disabled={busy === c.id}
                            onClick={() => dismiss(c)}>✕ 기각</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PagedList>
    </Section>
  );
}
