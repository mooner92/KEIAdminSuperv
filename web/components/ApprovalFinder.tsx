import { useEffect, useMemo, useState } from "react";
import SearchInput from "./common/SearchInput";
import styles from "./ApprovalFinder.module.css";

// Track B: 결재선 판정기 — 위임전결규정 별표(01n) 기반 업무·직급 → 전결권자 조회.
// ⛔ 공식 전결기준(별표 원문)만 표시, 실무 결재선은 부서 확인(면책은 호스트 패널에서 안내).

export type ApprovalRule = {
  구분: string; 업무: string; 대상: string;
  전결권자: string; 협의: string; 원장: boolean; 원문행: string;
};

const ROLE_KEY = "kei-approval-role"; // 마지막 선택 직급 기억(브라우저) — 계정 직급 설정의 경량 선행
const PAGE_ROLES_KEY = "kei-approval-roles"; // 전체 페이지(체크박스)의 선택과 기억 공유(첫 항목 사용)
const DEFAULT_ROLE = "비정규직(연구직)"; // 열릴 때 기본 직급 — 저장된 선택이 있으면 그것이 우선
// 자주 찾는 업무 퀵칩(드로어 전용) — 별표에 실제로 있는 키워드만 렌더(0건 칩 방지)
const QUICK_CHIPS = ["출장", "휴가", "병가", "휴직", "교육", "계약", "구매", "법인카드", "겸직", "출판"];

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
  // 직급은 잘 안 바뀌는 개인 속성 — 마지막 선택을 기억해 기본값으로(현재 데이터에 있는 직급만).
  // 전체 페이지(체크박스 kei-approval-roles)에서 고른 직급도 이어받는다(첫 항목).
  useEffect(() => {
    try {
      let saved = localStorage.getItem(ROLE_KEY);
      if (!saved) {
        const pageRoles: string[] = JSON.parse(localStorage.getItem(PAGE_ROLES_KEY) || "[]");
        saved = pageRoles[0] || "";
      }
      if (!saved) saved = DEFAULT_ROLE; // 저장된 선택이 없을 때의 기본 직급(사용자 요청)
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
  // 공백·중점 무시 정규화 — 별표 원문은 '국내 출장'·'실･팀장'처럼 표기가 섞여 있어
  // '국내출장'(채팅 감지 키워드)으로도 잡히게 한다. 다중 단어는 토큰 AND 매칭.
  const norm = (s: string) => s.replace(/[\s･·,]/g, "");

  // 퀵칩: 별표에 실제 결과가 있는 키워드만(0건 칩 방지), 최대 8개
  const chips = useMemo(
    () => QUICK_CHIPS.filter((kw) => rules.some((r) => norm(r.업무 + r.구분).includes(kw))).slice(0, 8),
    [rules],
  );
  const filtered = useMemo(() => {
    const tokens = q.trim().split(/\s+/).map(norm).filter(Boolean);
    return rules
      // 직급 필터: 해당 직급 행 + 직급 구분이 없는 행(금액구간 등 — 누구에게나 적용)은 유지
      .filter((r) => {
        if (role && r.대상 && r.대상 !== role) return false;
        if (!tokens.length) return true;
        const hay = norm(r.업무 + r.구분 + r.대상);
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 80);
  }, [rules, q, role]);

  return (
    <div>
      <div className={styles.controls}>
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ("")}
          placeholder="업무 검색 (예: 출장, 휴가, 계약, 구매)"
          ariaLabel="업무 검색"
        />
        <select className={styles.sel} value={role} onChange={(e) => pickRole(e.target.value)} aria-label="신청자 직급">
          <option value="">신청자 직급(전체)</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {chips.length > 0 ? (
        <div className={styles.chips} role="group" aria-label="자주 찾는 업무">
          {chips.map((kw) => (
            <button
              key={kw}
              type="button"
              className={q.trim() === kw ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              onClick={() => setQ(q.trim() === kw ? "" : kw)}
            >
              {kw}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.count}>{filtered.length}건{filtered.length >= 80 ? "+" : ""}</div>
      <ul className={styles.list}>
        {filtered.map((r, i) => (
          <li key={i} className={styles.row}>
            <div className={styles.work}>
              {r.구분 ? <span className={styles.cat}>{r.구분}</span> : null}
              <span className={styles.workName}>{r.업무}</span>
              {r.대상 ? <span className={styles.target}>{r.대상}</span>
                : role ? <span className={styles.cat} title="직급 구분 없이 금액·조건으로 정해지는 업무 — 직급 선택의 영향을 받지 않아요">직급 무관</span> : null}
            </div>
            <div className={styles.result}>
              전결 <b className={styles.owner}>{r.전결권자}</b>
              {r.협의 ? <span className={styles.consult}>협의 {r.협의}</span> : null}
              {r.원장 ? <span className={styles.wonjang}>원장 결재</span> : null}
            </div>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className={styles.empty}>
            해당 업무를 찾지 못했어요. 다른 키워드로 검색해 보세요.
            {role ? (
              // 병가·휴직처럼 정규/비정규 축을 쓰는 업무는 직급 필터에 안 걸릴 수 있음 → 원클릭 해제
              <button type="button" className={styles.clearRole} onClick={() => pickRole("")}>
                직급 필터({role}) 해제하고 다시 보기
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
