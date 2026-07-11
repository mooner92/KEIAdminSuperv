import { useCallback, useEffect, useState } from "react";
import { api, type RestoreDoc } from "../lib/api";
import styles from "../styles/Admin.module.css";

/** 표 복원 검수 탭(docs/24 §1) — 01p 복원 제안을 열람·대비하고 [반영]으로 승인(사람의 명시적 행위).
 *  ⛔ 자동 반영 없음. 반영 후에는 코퍼스 탭에서 재색인해야 검색에 반영된다. */
export default function AdminTableRestore() {
  const [docs, setDocs] = useState<RestoreDoc[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.tableRestoreList().then((r) => setDocs(r.docs)).catch((e) => setMsg(e instanceof Error ? e.message : "로드 실패"));
  }, []);
  useEffect(load, [load]);

  const apply = async (d: RestoreDoc) => {
    if (!window.confirm(
      `'${d.name}'의 복원 표 ${d.matchable}개를 볼트 원문에 반영합니다.\n` +
      "교체 전 원본은 백업되며, 반영 후 '코퍼스 관리 → 재색인'을 실행해야 검색에 적용됩니다.\n계속할까요?")) return;
    setBusy(d.name);
    try {
      const r = await api.tableRestoreApply(d.name);
      setMsg(`✅ ${d.name}: 표 ${r.matched}개 반영(백업 ${r.backups.length}건)` +
        (r.manual_needed.length ? ` · 수동 필요 ${r.manual_needed.length}표` : "") +
        " — 코퍼스 탭에서 재색인하세요.");
      load();
    } catch (e) {
      setMsg(`❌ ${d.name}: ${e instanceof Error ? e.message : "반영 실패"}`);
    } finally {
      setBusy("");
    }
  };

  if (!docs) return <p className={styles.lead}>{msg || "불러오는 중…"}</p>;
  return (
    <section>
      <p className={styles.lead}>
        HWP 변환에서 깨진 표를 <b>원본에서 결정적으로 재추출</b>한 제안입니다(생성 모델 미사용).
        내용을 확인하고 [반영]을 누르면 볼트 원문의 <b>같은 헤더·손상 판정 표만</b> 교체됩니다(원본 백업).
        ⚠ 원본 병합 구조 표는 자동 반영되지 않아요 — 제안의 줄 분해본을 참고해 수동으로 행을 나눠주세요.
      </p>
      {msg ? <p className={styles.restoreMsg}>{msg}</p> : null}
      <ul className={styles.restoreList}>
        {docs.map((d) => {
          const opened = open === d.name;
          return (
            <li key={d.name} className={styles.restoreRow}>
              <div className={styles.restoreHead} onClick={() => setOpen(opened ? null : d.name)} role="button" aria-expanded={opened}>
                <b>{d.name}</b>
                <span className={styles.muted}> · 원본 {d.source} · 표 {d.tables.length}개</span>
                {d.matchable > 0 ? <span className={styles.stOk}>자동 반영 가능 {d.matchable}</span> : null}
                {d.manual_needed.length > 0 ? <span className={styles.stWarn}>수동 필요 {d.manual_needed.length}</span> : null}
                {d.applied_at ? <span className={styles.stRev}>반영됨 {new Date(d.applied_at * 1000).toLocaleDateString("ko-KR")}</span> : null}
                <button
                  className={styles.applyBtn}
                  disabled={busy === d.name || d.matchable === 0}
                  onClick={(e) => { e.stopPropagation(); apply(d); }}
                  title={d.matchable === 0 ? "자동 반영 가능한 표가 없습니다(수동 반영)" : "복원 표를 볼트에 반영(원본 백업)"}
                >
                  {busy === d.name ? "반영 중…" : "반영"}
                </button>
              </div>
              {opened ? (
                <div className={styles.restoreBody}>
                  {d.표본.length ? (
                    <div className={styles.restoreBefore}>
                      <div className={styles.subline}>기존 볼트의 손상 표본</div>
                      {d.표본.map((s, i) => <code key={i} className={styles.brokenSample}>{s}</code>)}
                    </div>
                  ) : null}
                  {d.tables.map((t, ti) => (
                    <div key={ti} className={styles.restoreTable}>
                      <div className={styles.subline}>
                        {t.label} {t.verdict ? `· ⚠ 원본 병합 구조(${t.verdict}) — 수동 행 분리 필요` : "· ✅ 구조 복원"}
                      </div>
                      <div className={styles.tblScroll}>
                        <table>
                          <tbody>
                            {t.rows.slice(0, 14).map((row, ri) => (
                              <tr key={ri}>
                                {row.map((c, ci) => (
                                  <td key={ci}>
                                    {(c || "").split("<br>").map((ln, li) => (
                                      <span key={li}>{li > 0 ? <br /> : null}{ln}</span>
                                    ))}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {t.rows.length > 14 ? <div className={styles.muted}>… 외 {t.rows.length - 14}행(전체는 스테이징 md 참조)</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
        {docs.length === 0 ? <li className={styles.muted}>복원 제안이 없습니다 — tools/01o → 01p를 먼저 실행하세요.</li> : null}
      </ul>
    </section>
  );
}
