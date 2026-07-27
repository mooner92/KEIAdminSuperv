import { useEffect, useMemo, useRef, useState } from "react";
import SearchInput from "./common/SearchInput";
import AmountInput from "./common/AmountInput";
import AmountReason from "./approval/AmountReason";
import { amountVerdict, formatWon, parseAmountInput, type AmountRules } from "../lib/amountRules";
import { useFlag } from "../lib/flags";
import DocDrawer from "./DocDrawer";
import type { ApprovalRule } from "./ApprovalFinder";
import styles from "./Explorer.module.css";
import PagedList from "./common/PagedList";
import BrowseShell from "./common/BrowseShell";
import { FilterGroup, FilterCheck } from "./common/BrowseFilter";
import ResultRow, { ResultList, RowChip, RowTag, RowAction } from "./common/ResultRow";
import rowStyles from "./ApprovalFinder.module.css";

/**
 * 결재선 판정기(전체 페이지) — 문서 둘러보기(Explorer)와 동일한 UX/디자인:
 * 좌측 체크박스 필터(구분·신청자 직급·전결권자, 패싯 카운트) + 검색 범위 태그 + 페이지네이션.
 * Explorer.module.css를 그대로 재사용해 디자인을 통일한다.
 * ⛔ 위임전결규정 별표 원문 기준 — 실무 결재선은 부서 확인(면책은 페이지 헤더).
 */
const PAGE_SIZES = [10, 30, 50];
// 자주 찾는 업무 키워드(2클릭 조회: 좌측 직급 + 키워드 칩). 실건수 표시·0건 자동 숨김.
const KEYWORDS = ["출장", "휴가", "병가", "휴직", "채용", "교육", "결산", "예산", "계약", "구매", "법인카드", "출판", "겸직", "감사", "보수", "평가"];
const ROLES_KEY = "kei-approval-roles"; // 선택 직급 기억(브라우저) — 계정 직급 설정의 경량 선행

// 공백·중점 무시 정규화('국내출장'=='국내 출장') + 토큰 AND 매칭
const norm = (s: string) => s.replace(/[\s･·,]/g, "");

type Filters = { cat: Set<string>; role: Set<string>; owner: Set<string> };

const REG_SLUG = "2300_위임전결규정"; // 별표 원문 문서(slug = 파일 stem)

export default function ApprovalExplorer({ rules, amountRules = {} }: {
  rules: ApprovalRule[];
  /** 01r2 amount_rules.json(무결성 검증·사다리 정규화 완료) — 금액 축의 유일한 진실원천 */
  amountRules?: AmountRules;
}) {
  const upgrades = useFlag("explore_upgrades"); // v1 ⑭(S7-#33): 행→별표 원문 링크
  // 원문 드로어: 업무 경로의 가장 긴 구간을 하이라이트 후보로(표 행 매칭, 실패 시 문서 상단 — fail-soft)
  const [origText, setOrigText] = useState<string | null>(null);
  const openOrig = (r: ApprovalRule) => {
    const seg = r.업무.split(">").map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] || "";
    setOrigText(seg);
  };
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ cat: new Set(), role: new Set(), owner: new Set() });
  const listRef = useRef<HTMLUListElement>(null);

  // 직급 선택 기억(복원은 현재 데이터에 있는 값만)
  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(ROLES_KEY) || "[]");
      const valid = saved.filter((r) => rules.some((x) => x.대상 === r));
      if (valid.length) setF((prev) => ({ ...prev, role: new Set(valid) }));
      else if (rules.some((x) => x.대상 === "비정규직(연구직)"))
        setF((prev) => ({ ...prev, role: new Set(["비정규직(연구직)"]) })); // 기본 직급(드로어와 동일)
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

  // 금액 축(specs/06 D2): 입력값 문자열 + 해석된 원 단위. 판정은 amountRules 조회만.
  const [amountText, setAmountText] = useState("");
  const amountWon = useMemo(() => parseAmountInput(amountText), [amountText]);
  const verdictOf = (r: ApprovalRule) => amountVerdict(amountRules, r.구분, r.업무, amountWon);

  const matchesQuery = (r: ApprovalRule, tokens: string[]) => {
    if (!tokens.length) return true;
    const hay = norm(r.업무 + " " + r.대상 + " " + r.구분); // 검색 대상 고정: 업무+구분
    return tokens.every((t) => hay.includes(t));
  };

  const passes = (r: ApprovalRule, exclude?: keyof Filters) => {
    const tokens = q.trim().split(/\s+/).map(norm).filter(Boolean);
    if (!matchesQuery(r, tokens)) return false;
    if (exclude !== "cat" && f.cat.size && !f.cat.has(r.구분)) return false;
    // 직급: 선택 직급 행 + 직급 구분 없는 행(금액구간 등 — 누구에게나 적용)은 유지
    if (exclude !== "role" && f.role.size && r.대상 && !f.role.has(r.대상)) return false;
    if (exclude !== "owner" && f.owner.size && !f.owner.has(r.전결권자)) return false;
    // 금액: 구간이 있는 업무만 좁힌다(금액 무관 규칙은 항상 유지 — 사용자가 놓치지 않게)
    const v = verdictOf(r);
    if (v && !v.hit) return false;
    return true;
  };

  const filtered = useMemo(() => rules.filter((r) => passes(r)), [rules, q, f, amountWon]);

  // 키워드 칩 건수: 좌측 필터(직급·구분·전결권자) 반영 — 검색어와는 독립
  const kwCount = (kw: string) =>
    rules.filter((r) => {
      if (f.cat.size && !f.cat.has(r.구분)) return false;
      if (f.role.size && r.대상 && !f.role.has(r.대상)) return false;
      if (f.owner.size && !f.owner.has(r.전결권자)) return false;
      return norm(r.업무 + " " + r.구분).includes(kw);
    }).length;
  const kwChips = useMemo(
    () => KEYWORDS.map((k) => ({ k, n: kwCount(k) })).filter((x) => x.n > 0),
    [rules, f]
  );

  const total = filtered.length;
  const toTop = () => { if (listRef.current) listRef.current.scrollTop = 0; };

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

  const Check = ({ group, value, label }: { group: keyof Filters; value: string; label: string }) => (
    <FilterCheck label={label} count={countFor(group, value)}
      checked={f[group].has(value)} onChange={() => toggle(group, value)} />
  );

  // ⚠ 2026-07-28: Explorer.module.css의 셸 클래스(.wrap/.side/.filterToggle)를 빌려 쓰다
  // Explorer의 BrowseShell 이관(07-27) 때 그 클래스들이 삭제되며 레이아웃이 통째로 무너졌다.
  // 같은 수술로 교정 — 공용 BrowseShell 이관(P9: 화면별 셸 사본 금지의 재확인).
  const filters = (
    <>
      <FilterGroup title="신청자 직급">
          {roles.map((r) => <Check key={r} group="role" value={r} label={r} />)}
        </FilterGroup>
        <FilterGroup title="구분" scroll>
          {cats.map((c) => <Check key={c} group="cat" value={c} label={c} />)}
        </FilterGroup>
      <FilterGroup title="전결권자">
        {owners.map((o) => <Check key={o} group="owner" value={o} label={o} />)}
      </FilterGroup>
    </>
  );

  const head = (
    <div className={styles.searchWrap}>
          <div className={styles.searchRow}>
            <SearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              placeholder="업무 검색 — 예: 출장, 휴가, 계약 (아래 칩으로 바로 조회)"
              ariaLabel="업무 검색"
            />
            <AmountInput value={amountText} onChange={setAmountText} parsed={amountWon}
              ariaLabel="금액으로 좁히기" />
          </div>
          <div className={styles.scopeRow} role="group" aria-label="자주 찾는 업무">
            <span className={styles.scopeLabel}>자주 찾는 업무</span>
            {kwChips.map(({ k, n }) => (
              <button
                key={k}
                type="button"
                className={q.trim() === k ? `${styles.scopeChip} ${styles.scopeOn}` : styles.scopeChip}
                aria-pressed={q.trim() === k}
                onClick={() => setQ(q.trim() === k ? "" : k)}
              >
                {k} <span style={{ opacity: 0.6 }}>{n}</span>
              </button>
            ))}
          </div>
    </div>
  );

  return (
    <>
      <BrowseShell
        side={filters}
        head={head}
        sideTitle="필터"
        reset={activeCount > 0 ? { count: activeCount, onClick: reset } : null}
      >
        <PagedList
          items={filtered}
          unit="건"
          defaultSize={30}
          resetKey={`${q}|${[...f.cat].sort()}|${[...f.role].sort()}|${[...f.owner].sort()}|${amountWon ?? ""}`}
          empty="해당 업무를 찾지 못했어요. 다른 키워드나 필터로 시도해 보세요."
          onPage={toTop}
        >
          {(pageItems) => (
        <ResultList listRef={listRef}>
          {pageItems.map((r, i) => (
            <ResultRow
              key={`${r.구분}#${r.업무}#${i}`}
              title={r.업무}
              chips={
                <>
                  {r.구분 ? <RowTag>{r.구분}</RowTag> : null}
                  {r.대상 ? <RowChip>{r.대상}</RowChip>
                    : f.role.size > 0 ? <span title="이 업무는 직급 구분 없이 금액·조건으로 전결권자가 정해져요 — 직급 필터의 영향을 받지 않습니다"><RowTag>직급 무관</RowTag></span> : null}
                </>
              }
              body={(() => {
                const v = verdictOf(r);
                return v?.range && amountWon !== null
                  ? <AmountReason range={v.range} amountLabel={formatWon(amountWon)} />
                  : undefined;
              })()}
              right={
                <>
                  <span className={rowStyles.result}>
                    전결 <b className={rowStyles.owner}>{r.전결권자}</b>
                    {r.협의 ? <span className={rowStyles.consult}>협의 {r.협의}</span> : null}
                    {r.원장 ? <span className={rowStyles.wonjang}>원장 결재</span> : null}
                  </span>
                  {upgrades ? (
                    <RowAction onClick={() => openOrig(r)}
                      title="위임전결규정 별표 원문에서 확인">📜 원문</RowAction>
                  ) : null}
                </>
              }
            />
          ))}
        </ResultList>
          )}
        </PagedList>
      </BrowseShell>

      {/* v1 ⑭(S7-#33): 별표 원문 드로어 — 페이지 이동 없이 근거 확인 */}
      <DocDrawer
        slug={origText !== null ? REG_SLUG : null}
        highlight
        highlightText={origText || ""}
        onClose={() => setOrigText(null)}
      />
    </>
  );
}
