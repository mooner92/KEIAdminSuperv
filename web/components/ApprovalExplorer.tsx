import { useEffect, useMemo, useRef, useState } from "react";
import { ColorSchemeArea, SearchField } from "@toss/tds-mobile";
import { useTheme } from "../lib/theme";
import type { ApprovalRule } from "./ApprovalFinder";
import styles from "./Explorer.module.css";
import rowStyles from "./ApprovalFinder.module.css";

/**
 * 결재선 판정기(전체 페이지) — 규정 둘러보기(Explorer)와 동일한 UX/디자인:
 * 좌측 체크박스 필터(구분·신청자 직급·전결권자, 패싯 카운트) + 검색 범위 태그 + 페이지네이션.
 * Explorer.module.css를 그대로 재사용해 디자인을 통일한다.
 * ⛔ 위임전결규정 별표 원문 기준 — 실무 결재선은 부서 확인(면책은 페이지 헤더).
 */
const PAGE_SIZES = [10, 30, 50];
const SCOPE_FIELDS: { key: string; label: string }[] = [
  { key: "work", label: "업무" },
  { key: "cat", label: "구분" },
  { key: "owner", label: "전결권자" },
];
const ROLES_KEY = "kei-approval-roles"; // 선택 직급 기억(브라우저) — 계정 직급 설정의 경량 선행

// 공백·중점 무시 정규화('국내출장'=='국내 출장') + 토큰 AND 매칭
const norm = (s: string) => s.replace(/[\s･·,]/g, "");

type Filters = { cat: Set<string>; role: Set<string>; owner: Set<string> };

export default function ApprovalExplorer({ rules }: { rules: ApprovalRule[] }) {
  const { resolved } = useTheme();
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ cat: new Set(), role: new Set(), owner: new Set() });
  const [scope, setScope] = useState<Set<string>>(() => new Set(["work", "cat"]));
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);

  // 직급 선택 기억(복원은 현재 데이터에 있는 값만)
  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(ROLES_KEY) || "[]");
      const valid = saved.filter((r) => rules.some((x) => x.대상 === r));
      if (valid.length) setF((prev) => ({ ...prev, role: new Set(valid) }));
    } catch { /* ignore */ }
  }, [rules]);

  const cats = useMemo(() => {
    const set = Array.from(new Set(rules.map((r) => r.구분).filter(Boolean)));
    return set.sort((a, b) => {
      const na = parseInt(a, 10); const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b, "ko");
    });
  }, [rules]);
  const roles = useMemo(() => Array.from(new Set(rules.map((r) => r.대상).filter(Boolean))), [rules]);
  const owners = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const r of rules) cnt.set(r.전결권자, (cnt.get(r.전결권자) || 0) + 1);
    return Array.from(cnt.keys()).sort((a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0));
  }, [rules]);

  const toggleScope = (key: string) =>
    setScope((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      if (next.size === 0) next.add("work");
      return next;
    });

  const matchesQuery = (r: ApprovalRule, tokens: string[]) => {
    if (!tokens.length) return true;
    const hay = norm(
      [scope.has("work") ? r.업무 + " " + r.대상 : "", scope.has("cat") ? r.구분 : "", scope.has("owner") ? r.전결권자 : ""].join(" ")
    );
    return tokens.every((t) => hay.includes(t));
  };

  const passes = (r: ApprovalRule, exclude?: keyof Filters) => {
    const tokens = q.trim().split(/\s+/).map(norm).filter(Boolean);
    if (!matchesQuery(r, tokens)) return false;
    if (exclude !== "cat" && f.cat.size && !f.cat.has(r.구분)) return false;
    // 직급: 선택 직급 행 + 직급 구분 없는 행(금액구간 등 — 누구에게나 적용)은 유지
    if (exclude !== "role" && f.role.size && r.대상 && !f.role.has(r.대상)) return false;
    if (exclude !== "owner" && f.owner.size && !f.owner.has(r.전결권자)) return false;
    return true;
  };

  const filtered = useMemo(() => rules.filter((r) => passes(r)), [rules, q, f, scope]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => setPage(1), [q, f, pageSize, scope]);
  const cur = Math.min(page, pageCount);
  const start = (cur - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [cur]);

  const countFor = (group: keyof Filters, value: string) =>
    rules.filter((r) => {
      if (!passes(r, group)) return false;
      if (group === "cat") return r.구분 === value;
      if (group === "role") return r.대상 === value;
      return r.전결권자 === value;
    }).length;

  const toggle = (group: keyof Filters, value: string) =>
    setF((prev) => {
      const next = new Set(prev[group]);
      next.has(value) ? next.delete(value) : next.add(value);
      if (group === "role") {
        try { localStorage.setItem(ROLES_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      }
      return { ...prev, [group]: next };
    });

  const activeCount = f.cat.size + f.role.size + f.owner.size;
  const reset = () => {
    setF({ cat: new Set(), role: new Set(), owner: new Set() });
    try { localStorage.removeItem(ROLES_KEY); } catch { /* ignore */ }
  };

  const Check = ({ group, value, label }: { group: keyof Filters; value: string; label: string }) => {
    const n = countFor(group, value);
    const checked = f[group].has(value);
    return (
      <label className={`${styles.check} ${n === 0 && !checked ? styles.checkMuted : ""}`}>
        <input type="checkbox" checked={checked} onChange={() => toggle(group, value)} />
        <span className={styles.checkLabel}>{label}</span>
        <span className={styles.checkCount}>{n}</span>
      </label>
    );
  };

  return (
    <div className={styles.wrap}>
      <aside className={styles.side}>
        <div className={styles.sideHead}>
          <span className={styles.sideTitle}>필터</span>
          {activeCount > 0 ? (
            <button className={styles.reset} onClick={reset}>초기화 {activeCount}</button>
          ) : null}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>신청자 직급</div>
          {roles.map((r) => <Check key={r} group="role" value={r} label={r} />)}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>구분</div>
          <div className={styles.scrollGroup}>
            {cats.map((c) => <Check key={c} group="cat" value={c} label={c} />)}
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>전결권자</div>
          {owners.map((o) => <Check key={o} group="owner" value={o} label={o} />)}
        </div>
      </aside>

      <section className={styles.content}>
        <div className={styles.searchWrap}>
          <ColorSchemeArea theme={resolved}>
            <SearchField
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onDeleteClick={() => setQ("")}
              placeholder={`검색 (${SCOPE_FIELDS.filter((s) => scope.has(s.key)).map((s) => s.label).join("·")}) — 예: 출장, 휴가, 계약`}
              aria-label="업무 검색"
            />
          </ColorSchemeArea>
          <div className={styles.scopeRow} role="group" aria-label="검색 범위">
            <span className={styles.scopeLabel}>검색 범위</span>
            {SCOPE_FIELDS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={scope.has(s.key) ? `${styles.scopeChip} ${styles.scopeOn}` : styles.scopeChip}
                aria-pressed={scope.has(s.key)}
                onClick={() => toggleScope(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.count}>
            {total}건{total > 0 ? <span className={styles.range}> · {start + 1}–{start + pageItems.length}</span> : null}
          </span>
          <div className={styles.pager}>
            <div className={styles.pageSize} role="group" aria-label="페이지당 표시 개수">
              {PAGE_SIZES.map((n) => (
                <button
                  key={n}
                  className={pageSize === n ? `${styles.psBtn} ${styles.psActive}` : styles.psBtn}
                  onClick={() => setPageSize(n)}
                >
                  {n}
                </button>
              ))}
              <span className={styles.psUnit}>개씩</span>
            </div>
            {pageCount > 1 ? (
              <div className={styles.pageNav}>
                <button className={styles.navBtn} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
                <span className={styles.pageInfo}>{cur} / {pageCount}</span>
                <button className={styles.navBtn} disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
              </div>
            ) : null}
          </div>
        </div>

        <ul className={styles.list} ref={listRef}>
          {pageItems.map((r, i) => (
            <li key={`${start + i}`} className={rowStyles.rowLi}>
              <div className={rowStyles.row}>
                <div className={rowStyles.rule}>
                  {r.구분 ? <span className={rowStyles.cat}>{r.구분}</span> : null}
                  <span className={rowStyles.workName}>{r.업무}</span>
                  {r.대상 ? <span className={rowStyles.target}>{r.대상}</span> : null}
                </div>
                <div className={rowStyles.result}>
                  전결 <b className={rowStyles.owner}>{r.전결권자}</b>
                  {r.협의 ? <span className={rowStyles.consult}>협의 {r.협의}</span> : null}
                  {r.원장 ? <span className={rowStyles.wonjang}>원장 결재</span> : null}
                </div>
              </div>
            </li>
          ))}
          {total === 0 ? (
            <li className={rowStyles.empty}>해당 업무를 찾지 못했어요. 다른 키워드나 필터로 시도해 보세요.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
