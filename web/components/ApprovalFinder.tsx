import { useEffect, useMemo, useState } from "react";
import styles from "./ApprovalFinder.module.css";

// Track B: 결재선 판정기 — 위임전결규정 별표(01n) 기반 업무·직급 → 전결권자 조회.
// ⛔ 공식 전결기준(별표 원문)만 표시, 실무 결재선은 부서 확인(면책은 호스트 패널에서 안내).

export type ApprovalRule = {
  구분: string; 업무: string; 대상: string;
  전결권자: string; 협의: string; 원장: boolean; 원문행: string;
};

const ROLE_KEY = "kei-approval-role"; // 마지막 선택 직급 기억(브라우저) — 계정 직급 설정의 경량 선행

export default function ApprovalFinder({
  rules,
  initialQuery = "",
}: {
  rules: ApprovalRule[];
  /** 채팅 등에서 미리 채워줄 업무 키워드 (예: 질문에 '휴가' 언급 → '휴가') */
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [role, setRole] = useState("");
  useEffect(() => setQ(initialQuery), [initialQuery]);
  // 직급은 잘 안 바뀌는 개인 속성 — 마지막 선택을 기억해 기본값으로(현재 데이터에 있는 직급만)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ROLE_KEY);
      if (saved && rules.some((r) => r.대상 === saved)) setRole(saved);
    } catch { /* ignore */ }
  }, [rules]);
  const pickRole = (r: string) => {
    setRole(r);
    try { r ? localStorage.setItem(ROLE_KEY, r) : localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
  };
  const roles = useMemo(
    () => Array.from(new Set(rules.map((r) => r.대상).filter(Boolean))),
    [rules],
  );
  const filtered = useMemo(() => {
    const kw = q.trim();
    return rules
      // 직급 필터: 해당 직급 행 + 직급 구분이 없는 행(금액구간 등 — 누구에게나 적용)은 유지
      .filter((r) => (!kw || (r.업무 + r.구분 + r.대상).includes(kw)) && (!role || r.대상 === role || !r.대상))
      .slice(0, 80);
  }, [rules, q, role]);

  return (
    <div>
      <div className={styles.controls}>
        <input
          className={styles.search}
          placeholder="업무 검색 (예: 출장, 휴가, 계약, 구매)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="업무 검색"
        />
        <select className={styles.sel} value={role} onChange={(e) => pickRole(e.target.value)} aria-label="신청자 직급">
          <option value="">신청자 직급(전체)</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className={styles.count}>{filtered.length}건{filtered.length >= 80 ? "+" : ""}</div>
      <ul className={styles.list}>
        {filtered.map((r, i) => (
          <li key={i} className={styles.row}>
            <div className={styles.work}>
              {r.구분 ? <span className={styles.cat}>{r.구분}</span> : null}
              <span className={styles.workName}>{r.업무}</span>
              {r.대상 ? <span className={styles.target}>{r.대상}</span> : null}
            </div>
            <div className={styles.result}>
              전결 <b className={styles.owner}>{r.전결권자}</b>
              {r.협의 ? <span className={styles.consult}>협의 {r.협의}</span> : null}
              {r.원장 ? <span className={styles.wonjang}>원장 결재</span> : null}
            </div>
          </li>
        ))}
        {filtered.length === 0 ? <li className={styles.empty}>해당 업무를 찾지 못했어요. 다른 키워드로 검색해 보세요.</li> : null}
      </ul>
    </div>
  );
}
