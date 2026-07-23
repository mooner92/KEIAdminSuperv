import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import PagedList from "../components/common/PagedList";
import DeadlineBrowseRow from "../components/deadlines/DeadlineBrowseRow";
import DocDrawer from "../components/DocDrawer";
import { useFlag } from "../lib/flags";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import { loadDeadlines, type DeadlineEntry } from "../lib/vault";
import f from "../styles/Deadlines.module.css";

// 기한 사전(docs/57, flag deadlines_hub) — 전 규정 상대기한 역방향 브라우저(사건→규정).
// 서식 찾기(/forms)와 동형: 좌측 규정 필터 + 유형 세그먼트 + 통합 검색 1칸 + 페이지네이션.

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

type Kind = "전체" | "마감" | "기간한도";

export default function DeadlinesPage({ deadlines }: { deadlines: DeadlineEntry[] }) {
  const on = useFlag("deadlines_hub");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("전체");
  const [regFilter, setRegFilter] = useState<Set<string>>(new Set());
  const [regQ, setRegQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [doc, setDoc] = useState<{ slug: string; anchor: string } | null>(null); // 우측 조문 드로어

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => track("deadlines_search"), 1200); // 검색어 자체는 미전송(사용량만)
    return () => clearTimeout(t);
  }, [q]);

  // 검색 + 유형만 적용(규정 패싯 카운트 산출용)
  const searched = useMemo(() => {
    const t = norm(q);
    return deadlines.filter((e) => {
      if (kind !== "전체" && e.type !== kind) return false;
      if (!t) return true;
      return (
        norm(e.anchor).includes(t) ||
        norm(e.라벨사건 || "").includes(t) ||
        norm(e.라벨행동 || "").includes(t) ||
        norm(e.라벨대상 || "").includes(t) ||
        norm(e.의무).includes(t) ||
        norm(e.규정명).includes(t) ||
        norm(e.원문).includes(t)
      );
    });
  }, [q, kind, deadlines]);

  // 규정 목록(기한 수 내림차순) — 검색 결과 기준 패싯
  const regList = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const e of searched) cnt.set(e.규정명, (cnt.get(e.규정명) || 0) + 1);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  }, [searched]);
  const regShown = regQ.trim() ? regList.filter(([r]) => norm(r).includes(norm(regQ))) : regList;

  const shown = useMemo(
    () => (regFilter.size ? searched.filter((e) => regFilter.has(e.규정명)) : searched),
    [searched, regFilter]
  );
  const toggleReg = (r: string) =>
    setRegFilter((prev) => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });

  if (!on) {
    return (
      <Layout>
        <Head><title>{`기한 사전 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="기한 사전" lead="이 기능은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }

  const kinds: Kind[] = ["전체", "마감", "기간한도"];
  return (
    <Layout>
      <Head><title>{`기한 사전 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="기한 사전"
        lead={<>규정에 흩어진 <b>기한 {deadlines.length}건</b>을 사건·의무로 찾아, 기준일을 넣으면 마감일이
          계산돼요(.ics 저장). ⚠ 마감일은 원문 오프셋 그대로의 <b>단순 계산</b> — 정확한 기준은 원문·담당 부서
          확인이 필요합니다. <span className={f.leadSub}>규정집 기준일 {CORPUS_AS_OF}</span></>} />

      {/* 모바일 필터 토글(≤760px) */}
      <button type="button" className={f.filterToggle}
        onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen}>
        {filterOpen ? "규정 필터 접기 ▴" : `규정 필터 열기 ▾${regFilter.size > 0 ? ` · ${regFilter.size}개 적용 중` : ""}`}
      </button>

      <div className={f.layout}>
        <aside className={`${f.filters} ${filterOpen ? f.filtersOpenM : ""}`} aria-label="규정 필터">
          <div className={f.filterHead}>
            <span className={f.filterTitle}>규정</span>
            {regFilter.size > 0 ? (
              <button className={f.reset} onClick={() => setRegFilter(new Set())}>초기화 {regFilter.size}</button>
            ) : null}
          </div>
          <input className={f.regSearch} value={regQ} onChange={(e) => setRegQ(e.target.value)}
            placeholder="규정 이름으로 좁히기" aria-label="규정 필터 검색" />
          <div className={f.regList}>
            {regShown.map(([r, n]) => {
              const checked = regFilter.has(r);
              return (
                <label key={r} className={`${f.regItem} ${!checked && n === 0 ? f.regMuted : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleReg(r)} />
                  <span className={f.regName}>{r}</span>
                  <span className={f.regCount}>{n}</span>
                </label>
              );
            })}
            {regShown.length === 0 ? <p className={f.regEmpty}>해당 규정이 없어요.</p> : null}
          </div>
        </aside>

        <div className={f.main}>
          <input
            className={f.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="사건·의무·규정명으로 검색 — 예: 출장, 정산, 제출, 복귀"
            aria-label="기한 검색"
            autoFocus
          />
          {/* 공용 PagedList — 상단 한 줄(건수 · 유형 칩 · N개씩 · ‹n/N›). 손수 만든 페이저 제거 */}
          <PagedList
            items={shown}
            unit="건"
            defaultSize={30}
            resetKey={`${q}|${kind}|${[...regFilter].sort().join(",")}`}
            empty="검색 결과가 없어요 — 다른 사건이나 규정명으로 찾아보세요."
            filterSlot={
              <span className={f.kinds} role="tablist" aria-label="기한 유형">
                {kinds.map((k) => (
                  <button key={k} role="tab" aria-selected={kind === k}
                    className={`${f.kindBtn} ${kind === k ? f.kindActive : ""}`}
                    onClick={() => setKind(k)}>{k}</button>
                ))}
              </span>
            }
          >
            {(paged) => (
              <ul className={f.list}>
                {paged.map((e, i) => (
                  <DeadlineBrowseRow key={`${e.규정명}#${e.조}#${i}`} e={e}
                    onOpenDoc={(slug, anchor) => setDoc({ slug, anchor })} />
                ))}
              </ul>
            )}
          </PagedList>
          <p className={f.note}>
            ※ 기한·오프셋은 규정 원문에서 추출한 값이고, 제목·할 일 라벨은 원문 문장에서 자동 생성한
            요약입니다(모두 검수 전 — 원문 문장을 항상 함께 표시). 마감일은 기준일 ± 기간의 단순
            계산입니다. 공휴일·기산일 규칙 등은 원문과 담당 부서 안내를 함께 확인하세요.
          </p>
        </div>
      </div>
      {/* 조문 사이드 드로어 — 목록 흐름을 유지한 채 원문 확인(LLM 근거 열람과 동일 컴포넌트) */}
      <DocDrawer slug={doc?.slug ?? null} anchor={doc?.anchor ?? ""} onClose={() => setDoc(null)} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { deadlines: loadDeadlines() } });
