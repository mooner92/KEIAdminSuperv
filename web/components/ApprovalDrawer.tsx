import { useEffect, useState } from "react";
import AsyncState from "./AsyncState";
import Link from "next/link";
import ApprovalFinder, { type ApprovalRule } from "./ApprovalFinder";
import docStyles from "./DocDrawer.module.css";
import styles from "./DocDrawer.module.css";

/**
 * 결재선 드로어 — 채팅 근거 패널에서 "결재선 알아볼까요?"를 누르면
 * 문서 드로어처럼 오른쪽에서 슬라이드인되어 결재선 판정기를 연다.
 * initialQuery: 질문에서 감지한 업무 키워드(예: 휴가)를 미리 채운다.
 * 데이터는 out/approval.json lazy fetch(열 때 1회).
 */
export default function ApprovalDrawer({
  open,
  initialQuery = "",
  onClose,
}: {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<ApprovalRule[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || rules !== null) return;
    fetch("/approval.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setRules(d.rules || []))
      .catch(() => setErr("전결규칙 데이터를 불러오지 못했습니다."));
  }, [open, rules]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div className={`${docStyles.overlay} ${open ? docStyles.open : ""}`} aria-hidden={!open}>
      <div className={docStyles.backdrop} onClick={onClose} />
      <aside className={docStyles.panel} role="dialog" aria-modal="true" aria-label="결재선 판정기">
        <div className={docStyles.bar}>
          <span className={docStyles.barTitle}>🖋 결재선 판정기</span>
          <div className={docStyles.barRight}>
            <Link className={docStyles.expand} href="/approval/" title="전체 화면으로 열기">↗ 전체화면</Link>
            <button className={docStyles.close} onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>
        <div className={docStyles.scroll}>
          <article className={docStyles.article}>
            <p className={styles.taHint}>
              위임전결규정 별표 기준 <b>전결권자</b>(최종 결재)입니다. ⚠ 실제 결재선(중간 검토자 등)은
              부서마다 다를 수 있어요 — 반드시 부서 확인.
            </p>
            <AsyncState loading={!err && rules === null} error={err}
              onRetry={() => { setErr(""); setRules(null); }} />
            {rules !== null ? <ApprovalFinder rules={rules} initialQuery={initialQuery} /> : null}
          </article>
        </div>
      </aside>
    </div>
  );
}
