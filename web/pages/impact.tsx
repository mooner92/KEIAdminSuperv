import Head from "next/head";
import { useMemo, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import BrowseShell from "../components/common/BrowseShell";
import SearchInput from "../components/common/SearchInput";
import PagedList from "../components/common/PagedList";
import { FilterGroup, FilterCheck } from "../components/common/BrowseFilter";
import ResultRow, { ResultList, RowChip, RowTag, RowBadge } from "../components/common/ResultRow";
import DocDrawer from "../components/DocDrawer";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { loadImpact, type ImpactArticle, type ImpactPayload } from "../lib/vault";
import s from "../styles/Impact.module.css";

// 개정 영향 분석(specs/05) — "이 조문을 고치면 어디를 확인해야 하나".
// 데이터 = 01l impact_by_article(결정적 그래프 — LLM 무관). ⚠ 목록은 '확인 후보'이지
// '고쳐야 할 목록'이 아니다(과탐 허용 설계) — 히어로·빈 화면 문구에 명시.

const TYPE_LABEL: Record<string, string> = {
  direct: "직접 인용", transitive: "간접(전이)", guides: "가이드·안내", forms: "별표·서식", deadlines: "기한",
};
const TYPES = ["direct", "transitive", "guides", "forms", "deadlines"] as const;

export default function ImpactPage({ items, regSlugs }: ImpactPayload) {
  const on = useFlag("impact_analysis");
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState(false); // 최근 90일 개정 조문만
  const [drawer, setDrawer] = useState<{ slug: string; anchor: string } | null>(null);

  const norm = (t: string) => t.toLowerCase().replace(/[\s･·]/g, "");

  const filtered = useMemo(() => {
    const needle = norm(q);
    return items.filter((it) => {
      // 사람 표기(공백·제목 포함)로 검색 — key의 "#"는 검색 대상에서 제외(실렌더에서 0건 원인)
      if (needle && !norm(`${it.reg} ${it.jo} ${it.title}`).includes(needle)) return false;
      if (recent && !it.recentRevised) return false;
      if (types.size && !TYPES.some((t) => types.has(t) && (it[t]?.length || 0) > 0)) return false;
      return true;
    });
  }, [items, q, types, recent]);

  const countFor = (t: string) =>
    items.filter((it) => (it[t as keyof ImpactArticle] as string[] | undefined)?.length).length;
  const toggle = (t: string) =>
    setTypes((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  if (!on) {
    return (
      <Layout>
        <Head><title>{`개정 영향 분석 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="개정 영향 분석" lead="이 기능은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }

  return (
    <Layout fill>
      <Head><title>{`개정 영향 분석 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="개정 영향 분석"
        lead={<>조문을 고르면 <b>그 조문을 인용·준용하는 조문, 가이드, 서식, 기한</b>을 한 번에 보여드려요
          — 규정을 고치기 전에 어디를 확인해야 하는지의 지도입니다. ⚠ 목록은 <b>확인 후보</b>이며
          수정 대상 확정이 아니에요(최종 판단은 담당 부서).</>} />
      <BrowseShell
        sideTitle="필터"
        reset={{ count: types.size + (recent ? 1 : 0), onClick: () => { setTypes(new Set()); setRecent(false); } }}
        side={
          <>
            <FilterGroup title="영향 유형">
              {TYPES.map((t) => (
                <FilterCheck key={t} label={TYPE_LABEL[t]} count={countFor(t)}
                  checked={types.has(t)} onChange={() => toggle(t)} />
              ))}
            </FilterGroup>
            <FilterGroup title="개정 시점">
              <FilterCheck label="최근 90일 개정 조문만" count={items.filter((i) => i.recentRevised).length}
                checked={recent} onChange={() => setRecent(!recent)} />
            </FilterGroup>
          </>
        }
        head={
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")}
            placeholder="규정명·조문으로 검색 — 예: 복무규정 제19조, 인사규정" ariaLabel="조문 검색" />
        }
      >
        <PagedList
          items={filtered}
          unit="건"
          defaultSize={30}
          note="파급 넓은 순"
          resetKey={`${q}|${[...types].sort()}|${recent}`}
          empty="파급 정보가 있는 조문 중 조건에 맞는 것이 없어요."
        >
          {(paged) => (
            <ResultList>
              {paged.map((it) => (
                <ResultRow
                  key={it.key}
                  lead={it.jo}
                  title={`${it.reg} ${it.jo}${it.title ? ` (${it.title})` : ""}`}
                  chips={
                    <>
                      {it.recentRevised ? <RowBadge>최근 개정 {it.revised}</RowBadge> : it.revised ? <RowTag>개정 {it.revised}</RowTag> : null}
                      {TYPES.map((t) => (it[t]?.length ? <RowChip key={t}>{TYPE_LABEL[t]} {it[t]!.length}</RowChip> : null))}
                    </>
                  }
                  body={
                    <span className={s.detail}>
                      {TYPES.map((t) => it[t]?.length ? (
                        <span key={t} className={s.group}>
                          <b className={s.gLabel}>{TYPE_LABEL[t]}</b>
                          {it[t]!.slice(0, 8).map((x) => {
                            const [reg2, jo2] = x.includes("#") ? x.split("#") : [x, ""];
                            // guides는 stem(=slug), 나머지는 규정명 → 전역 매핑
                            const slug = t === "guides" ? x : (regSlugs[reg2] || "");
                            return slug ? (
                              <button key={x} type="button" className={s.link}
                                onClick={() => setDrawer({ slug, anchor: jo2 })}>{reg2}{jo2 ? ` ${jo2}` : ""}</button>
                            ) : <span key={x} className={s.plain}>{x}</span>;
                          })}
                          {it[t]!.length > 8 ? <span className={s.more}>외 {it[t]!.length - 8}</span> : null}
                        </span>
                      ) : null)}
                    </span>
                  }
                />
              ))}
            </ResultList>
          )}
        </PagedList>
      </BrowseShell>
      <DocDrawer slug={drawer?.slug ?? null} anchor={drawer?.anchor ?? ""} onClose={() => setDrawer(null)} />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: loadImpact() });
