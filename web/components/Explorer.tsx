import { useEffect, useMemo, useRef, useState } from "react";
import SearchInput from "./common/SearchInput";
import PagedList from "./common/PagedList";
import BrowseShell from "./common/BrowseShell";
import { FilterGroup, FilterCheck } from "./common/BrowseFilter";
import ResultRow, { ResultList, RowChip, RowTag, RowDate, RowBadge, rowHl } from "./common/ResultRow";
import type { DocMeta, SectionKey } from "../lib/vault";
import { useFlag } from "../lib/flags";
import DocDrawer from "./DocDrawer";
import styles from "./Explorer.module.css";

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "사내 시스템",
  대외업무: "대외업무",
  상위법령: "상위 법령(참고)",
};
const SECTIONS: SectionKey[] = ["규정집", "가이드", "용어집", "시스템", "대외업무", "상위법령"];
const REVIEWED = ["검수완료", "미검수"];
const PAGE_SIZES = [10, 30, 50];
// 검색 범위 필드(content_search 플래그 on일 때 선택 가능). 기본 = 제목+내용.
const SCOPE_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: "제목" },
  { key: "regNo", label: "규정번호" },
  { key: "category", label: "분류" },
  { key: "content", label: "내용" },
];
// 플래그 off일 때 적용되는 고정 범위(기존 동작: 제목+번호+분류)
const OFF_SCOPE = new Set(["title", "regNo", "category"]);

// v1 ⑬(S7-#28): 공백·중점 무시 정규화 — 결재선 판정기와 동일 규칙('복무 규정'=='복무규정')
const norm = (s: string) => s.toLowerCase().replace(/[\s･·,]/g, "");

const reviewedOf = (d: DocMeta) => (d.reviewed === "검수완료" ? "검수완료" : "미검수");

type Filters = { section: Set<string>; category: Set<string>; reviewed: Set<string> };

/**
 * 문서 둘러보기 — 좌측 체크박스 필터(섹션·분류·검수상태) + 검색 + 결과 목록.
 * 행을 클릭하면 페이지 이동 없이 우측 Notion형 드로어로 본문을 연다.
 */
export default function Explorer({ docs }: { docs: DocMeta[] }) {
  const contentSearchOn = useFlag("content_search");
  const upgrades = useFlag("explore_upgrades"); // v1 ⑬(S7): URL 딥링크 등
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ section: new Set(), category: new Set(), reviewed: new Set() });
  const [openSlug, setOpenSlugRaw] = useState<string | null>(null);
  // v1 ⑬(S7-#27): 드로어 상태 URL 동기화(?doc=슬러그) — 딥링크 공유·브라우저 뒤로가기 연동(flag)
  const setOpenSlug = (slug: string | null) => {
    setOpenSlugRaw(slug);
    if (!upgrades || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set("doc", slug);
    else url.searchParams.delete("doc");
    window.history.pushState({ doc: slug }, "", url.toString());
  };
  useEffect(() => {
    if (!upgrades || typeof window === "undefined") return;
    const init = new URL(window.location.href).searchParams.get("doc");
    if (init) setOpenSlugRaw(init); // 딥링크 진입
    const onPop = () => setOpenSlugRaw(new URL(window.location.href).searchParams.get("doc"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upgrades]);
  const listRef = useRef<HTMLUListElement>(null);
  const toTop = () => { if (listRef.current) listRef.current.scrollTop = 0; };

  // 사용자 선택 검색범위(플래그 on 모드) — 기본 제목+내용. 플래그는 async 로드라 상수로 초기화.
  const [scope, setScope] = useState<Set<string>>(() => new Set(["title", "content"]));
  // 실제 적용 범위: 플래그 off면 기존 동작(제목+번호+분류) 고정, on이면 사용자 선택(scope).
  const activeScope = contentSearchOn ? scope : OFF_SCOPE;
  // 원문 내용 인덱스: '내용' 범위가 켜졌을 때만 1회 lazy-load(번들 비대화 방지).
  const [index, setIndex] = useState<Record<string, string> | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  useEffect(() => {
    if (!contentSearchOn || !scope.has("content") || index || indexLoading) return;
    setIndexLoading(true);
    fetch("/search-index.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => setIndex(j))
      .catch(() => setIndex({}))
      .finally(() => setIndexLoading(false));
  }, [contentSearchOn, scope, index, indexLoading]);

  const toggleScope = (key: string) =>
    setScope((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      if (next.size === 0) next.add("title"); // 최소 하나는 유지
      return next;
    });

  // 분류 목록(데이터에서 도출)
  const categories = useMemo(
    () => Array.from(new Set(docs.map((d) => d.category).filter(Boolean))).sort(),
    [docs]
  );

  // 적용 범위(activeScope)로 needle 매칭. '내용'은 lazy-load된 index[slug](소문자 평문) 사용.
  const matchesQuery = (d: DocMeta, needle: string) => {
    const meta: string[] = [];
    if (activeScope.has("title")) meta.push(d.title);
    if (activeScope.has("regNo")) meta.push(d.regNo);
    if (activeScope.has("category")) meta.push(d.category);
    // 메타 필드는 norm 토큰 AND('복무 규정'→'복무규정' 매칭, #28) — 내용 인덱스는 기존 부분일치 유지
    const hay = norm(meta.join(" "));
    const tokens = needle.split(/\s+/).map(norm).filter(Boolean);
    if (tokens.length && tokens.every((t) => hay.includes(t))) return true;
    if (activeScope.has("content") && index && (index[d.slug] || "").includes(needle)) return true;
    return false;
  };

  // 한 그룹을 제외한 나머지 필터 + 검색을 통과하는지(패싯 카운트/결과용)
  const passes = (d: DocMeta, exclude?: keyof Filters) => {
    const needle = q.trim().toLowerCase();
    if (needle && !matchesQuery(d, needle)) return false;
    if (exclude !== "section" && f.section.size && !f.section.has(d.section)) return false;
    if (exclude !== "category" && f.category.size && !f.category.has(d.category)) return false;
    if (exclude !== "reviewed" && f.reviewed.size && !f.reviewed.has(reviewedOf(d))) return false;
    return true;
  };

  const filtered = useMemo(() => docs.filter((d) => passes(d)), [docs, q, f, scope, index, contentSearchOn]);

  // 내용 매칭 스니펫(제목/번호/분류에 안 걸리고 본문에만 걸릴 때 어디서 걸렸는지 미리보기)
  const snippetOf = (d: DocMeta): string => {
    if (!contentSearchOn || !activeScope.has("content") || !index) return "";
    const needle = q.trim().toLowerCase();
    if (!needle) return "";
    const metaHit = [
      activeScope.has("title") && d.title,
      activeScope.has("regNo") && d.regNo,
      activeScope.has("category") && d.category,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
    if (metaHit) return ""; // 메타에 이미 걸리면 스니펫 불필요
    const text = index[d.slug] || "";
    const i = text.indexOf(needle);
    if (i < 0) return "";
    const start = Math.max(0, i - 36);
    return (start > 0 ? "…" : "") + text.slice(start, i + needle.length + 72).trim() + "…";
  };

  const total = filtered.length;

  // 패싯 카운트(다른 필터를 반영한 각 옵션의 건수)
  const countFor = (group: keyof Filters, value: string) =>
    docs.filter((d) => {
      if (!passes(d, group)) return false;
      if (group === "section") return d.section === value;
      if (group === "category") return d.category === value;
      return reviewedOf(d) === value;
    }).length;

  const toggle = (group: keyof Filters, value: string) =>
    setF((prev) => {
      const next = new Set(prev[group]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...prev, [group]: next };
    });

  const activeCount = f.section.size + f.category.size + f.reviewed.size;
  const reset = () => setF({ section: new Set(), category: new Set(), reviewed: new Set() });

  // v1 ⑬(S7-#28): 검색어와 겹치는 제목 부분 <mark> 강조(첫 토큰 기준, 공백 무시 근사)
  const markTitle = (title: string): React.ReactNode => {
    const t = q.trim().split(/\s+/)[0] || "";
    if (!t) return title;
    const i = title.toLowerCase().indexOf(t.toLowerCase());
    if (i < 0) return title;
    return (<>{title.slice(0, i)}<mark className={rowHl}>{title.slice(i, i + t.length)}</mark>{title.slice(i + t.length)}</>);
  };

  const Check = ({ group, value, label }: { group: keyof Filters; value: string; label: string }) => (
    <FilterCheck label={label} count={countFor(group, value)}
      checked={f[group].has(value)} onChange={() => toggle(group, value)} />
  );

  // ⚠ 2026-07-27: 자체 셸 → 공용 BrowseShell로 이관.
  // 자체 구조에는 BrowseShell의 `.pagedFill > div` flex 전파 계약이 없어 **목록이 스크롤되지 않았다**
  // (필터만 스크롤 · 목록 아래 항목에 도달 불가). "이미 동일 계약이라 이관 불필요"라는 판단이 틀렸다.
  const filters = (
    <>
      <FilterGroup title="구분">
          {SECTIONS.map((s) => (<Check key={s} group="section" value={s} label={SECTION_LABEL[s]} />))}
        </FilterGroup>
        <FilterGroup title="분류" scroll>
          {categories.map((c) => (<Check key={c} group="category" value={c} label={c} />))}
        </FilterGroup>
      <FilterGroup title="검수상태">
        {REVIEWED.map((r) => (<Check key={r} group="reviewed" value={r} label={r} />))}
      </FilterGroup>
    </>
  );

  const head = (
    <div className={styles.searchWrap}>
          <SearchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClear={() => setQ("")}
            placeholder={
              contentSearchOn
                ? `검색 (${SCOPE_FIELDS.filter((s) => scope.has(s.key)).map((s) => s.label).join("·")})`
                : "제목 · 규정번호 · 분류로 검색"
            }
            ariaLabel="검색"
          />
          {contentSearchOn ? (
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
                  {s.key === "content" && scope.has("content") && indexLoading ? " …" : ""}
                </button>
              ))}
            </div>
      ) : null}
    </div>
  );

  return (
    <>
      <BrowseShell
        side={filters}
        head={head}
        reset={activeCount > 0 ? { count: activeCount, onClick: reset } : null}
      >
        <PagedList
          items={filtered}
          unit="건"
          defaultSize={30}
          resetKey={`${q}|${[...f.section].sort()}|${[...f.category].sort()}|${[...f.reviewed].sort()}|${[...scope].sort()}`}
          empty="조건에 맞는 문서가 없어요."
          onPage={toTop}
        >
          {(pageItems) => (
        <ResultList listRef={listRef}>
          {pageItems.map((d) => {
            const snip = snippetOf(d);
            return (
              <ResultRow
                key={d.slug}
                lead={d.regNo || "—"}
                title={markTitle(d.title)}
                chips={
                  <>
                    <RowChip section={d.section}>{SECTION_LABEL[d.section]}</RowChip>
                    {d.category ? <RowTag>{d.category}</RowTag> : null}
                    {d.articleCount > 0 ? <RowTag>{d.articleCount}개 조문</RowTag> : null}
                  </>
                }
                snippet={snip ? `📄 ${snip}` : undefined}
                right={
                  <>
                    <RowDate>{d.revised || "—"}</RowDate>
                    <RowBadge ok={d.reviewed === "검수완료"}>{d.reviewed || "미검수"}</RowBadge>
                  </>
                }
                onClick={() => setOpenSlug(d.slug)}
              />
            );
          })}
        </ResultList>
          )}
        </PagedList>
      </BrowseShell>
      <DocDrawer slug={openSlug} onClose={() => setOpenSlug(null)} />
    </>
  );
}
