import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import JourneyMap from "../components/JourneyMap";
import FreshnessNote from "../components/journey/FreshnessNote";
import DocDrawer from "../components/DocDrawer";
import { useFlag } from "../lib/flags";
import { track } from "../lib/track";
import { SITE_NAME, CORPUS_AS_OF } from "../lib/site";
import { getAllDocs, loadJourneys, type Journey } from "../lib/vault";
import styles from "../styles/Home.module.css";
import jm from "../components/JourneyMap.module.css";

/**
 * 업무 한 장(docs/25) — 업무 전체 여정(신청→결재→수행→정산→보고)을 스윔레인/스텝퍼로.
 * 실측 근거: 신입이 '출장 처리' 지시 하나에 6턴 소요(전체 그림 부재) → 시작 전 1회 열람으로 압축.
 * ⛔ 노드 데이터는 볼트(90_관리/_journeys) 수작업 큐레이션 — 미검수 시작, 근거 조문 필수.
 */
export default function JourneyPage({
  journeys,
  titleSlugs,
}: {
  journeys: Journey[];
  titleSlugs: [string, string][];
}) {
  const on = useFlag("journey_map");
  const freshOn = useFlag("journey_freshness");   // 신선도 배지(specs/13 T01b)
  useEffect(() => { if (on) track("journey_view"); }, [on]);
  const [cur, setCur] = useState(0);
  // /journey/?task=<id> 딥링크(후속 제안 칩에서 진입) — 정적 export라 하이드레이션 후 파싱
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("task");
      if (!id) return;
      const i = journeys.findIndex((x) => x.id === id);
      if (i >= 0) setCur(i);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drawer, setDrawer] = useState<{ slug: string; anchor: string; text: string } | null>(null);
  const titleToSlug = useMemo(() => new Map(titleSlugs), [titleSlugs]);
  const j = journeys[cur];

  const openDoc = (규정명: string, 조: string) => {
    const slug = titleToSlug.get(규정명);
    if (!slug) return;
    const isJo = /^제\d+조/.test(조);
    setDrawer({ slug, anchor: isJo ? 조 : "", text: isJo ? "" : 조 });
  };

  return (
    <Layout>{/* fill 금지 — 상세 패널이 열리면 세로로 길어져 전체 페이지 스크롤이 자연스러움(푸터 침범 방지) */}
      <Head>
        <title>{`업무 한 장 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <PageHero title="업무 한 장" lead={<>
        업무의 전체 흐름(누가 · 어느 화면에서 · 언제까지)을 한 장으로 봅니다. 단계를 누르면 근거
        조문과 ERP 경로가 열려요. ⚠ <b>공식 기준은 항상 원문</b> — 실제 결재선·기한은 부서 확인이
        필요합니다. <span className={styles.leadSub}>문서 기준일 {CORPUS_AS_OF}</span>
      </>} />
      {!on ? (
        <p className={styles.lead}>이 기능은 아직 준비 중이에요. (관리자가 켜면 사용할 수 있습니다)</p>
      ) : journeys.length === 0 ? (
        <p className={styles.lead}>여정 데이터가 없습니다 — 볼트 90_관리/_journeys를 확인하세요.</p>
      ) : (
        <>
          <div className={jm.picker} role="tablist" aria-label="업무 선택">
            {journeys.map((x, i) => (
              <button key={x.id} role="tab" aria-selected={i === cur}
                className={`${jm.pick} ${i === cur ? jm.pickOn : ""}`} onClick={() => setCur(i)}>
                {x.emoji} {x.title}
              </button>
            ))}
          </div>
          <p className={jm.summary}>
            {j.요약} · 단계 {j.stages.length} · 근거 {j.nodes.reduce((a, n) => a + n.근거.length, 0)}건
            {j.검수상태 !== "검수완료" ? <span className={jm.unreviewed}>미검수 — 원문 확인 필요</span> : null}
          </p>
          {/* 신선도(specs/13 T01b) — 근거 조문이 삭제·개정됐으면 여정을 믿기 전에 알려준다.
              ⛔ 지도보다 위에 둔다: 낡았을 수 있다는 사실을 보고 나서 내용을 읽어야 한다. */}
          {freshOn ? <FreshnessNote f={j.신선도} onOpenDoc={openDoc} /> : null}
          <JourneyMap journey={j} onOpenDoc={openDoc} />
          <p className={jm.footNote}>
            데이터: <Link href="/browse/">규정 원문</Link>·ERP 가이드에서 대조해 정리(검수 전). 오류 제보는 답변 👎로.
          </p>
        </>
      )}
      <DocDrawer
        slug={drawer?.slug ?? null}
        anchor={drawer?.anchor || ""}
        highlight
        highlightText={drawer?.text || ""}
        onClose={() => setDrawer(null)}
      />
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const journeys = loadJourneys();
  // 근거 조문 → 문서 드로어 매핑(제목→슬러그). 여정에 등장하는 규정명만 실어 payload 최소화.
  const need = new Set<string>();
  for (const j of journeys)
    for (const n of j.nodes) {
      for (const b of n.근거) need.add(b.규정명);
      if (n.기한) need.add(n.기한.근거.규정명);
      if (n.전결) need.add(n.전결.근거.규정명);
    }
  // 신선도 알림의 근거 조문도 눌러서 열린다 — 노드 근거의 부분집합이지만 01k2가 훑는 범위가
  // 넓어지면 조용히 '눌러도 안 열리는 링크'가 된다. 여기서 함께 담아 그 가능성을 없앤다.
  for (const j of journeys) for (const r of j.신선도?.항목 ?? []) need.add(r.규정명);
  const titleSlugs: [string, string][] = [];
  for (const d of getAllDocs()) if (need.has(d.title)) titleSlugs.push([d.title, d.slug]);
  return { props: { journeys, titleSlugs } };
};
