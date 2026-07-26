import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import ShortcutCard, { type Shortcut } from "../components/now/ShortcutCard";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import {
  loadChangelog, loadDeadlines, loadForms, loadSeasonal, recentlyRevised, termPool,
  type ChangelogEntry, type SeasonalItem,
} from "../lib/vault";
import n from "../styles/Now.module.css";

// "추가 기능" 허브(docs/35·41, flag events_tab) — 유틸 기능 바로가기 + 요즘 흐름 정보를 한곳에.
// 서식 찾기·새로워진 점·업무 캘린더 진입을 여기로 모아 GNB·푸터를 정리(docs/41).

type Props = {
  seasonal: SeasonalItem[];
  revised: { slug: string; title: string; revised: string }[];
  notes: Pick<ChangelogEntry, "id" | "제목" | "날짜" | "분류">[];
  terms: { slug: string; title: string }[];
  formsCount: number;
  deadlinesCount: number;
};

export default function NowPage({ seasonal, revised, notes, terms, formsCount, deadlinesCount }: Props) {
  const on = useFlag("events_tab");
  const formsOn = useFlag("forms_registry"); // 서식 찾기 바로가기 게이트
  const deadlinesOn = useFlag("deadlines_hub"); // 기한 사전 바로가기 게이트(docs/57)
  const qualityOn = useFlag("quality_board"); // 품질 게시판 게이트(docs/58)
  const changelogOn = useFlag("changelog");  // 새로워진 점 바로가기 게이트
  const approvalOn = useFlag("approval_finder");
  const impactOn = useFlag("impact_analysis"); // specs/05: 개정 영향 분석 // 결재선 — 모바일 GNB에서 빠진 화면의 허브 도달(docs/48)
  const journeyOn = useFlag("journey_map"); // 업무 한 장 — 〃
  const feedbackOn = useFlag("feedback_center"); // 의견 보내기(docs/51) — 허브 카드
  const landingOn = useFlag("landing_page"); // 소개 — 모바일 셸에선 푸터가 숨어 허브가 유일 진입(docs/54 v2)
  const { user } = useAuth(); // 관리자 카드(조건) — 〃
  const [month, setMonth] = useState<number | null>(null); // 이번 달 — null = 클라이언트 미확정(SSG 안전)
  const [trending, setTrending] = useState<{ k: string; n: number }[] | null>(null);
  const [trendErr, setTrendErr] = useState<number | null>(null); // HTTP status(401=로그인 필요) | 0=기타

  useEffect(() => { setMonth(new Date().getMonth() + 1); }, []);
  useEffect(() => {
    if (!on) return;
    track("now_view"); // flag off면 미발화(서버도 무시하지만 전송 자체를 안 함)
    api.trending(7).then((r) => setTrending(r.keywords))
      .catch((e) => setTrendErr(typeof e?.status === "number" ? e.status : 0));
  }, [on]);

  // 오늘의 용어 — 날짜 시드로 결정적 선택(같은 날 = 같은 용어, 정적 export라 클라이언트 계산).
  const todayTerm = useMemo(() => {
    if (!terms.length || month === null) return null;
    const d = new Date();
    const seed = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
    return terms[seed % terms.length];
  }, [terms, month]);

  // 이번 달 고유 항목 + 매월(상시, month 0). 상세·다른 달은 /calendar로 이전(docs/40).
  const monthItems = useMemo(
    () => (month === null ? [] : seasonal.filter((s) => s.month === month)),
    [seasonal, month]
  );
  const everyMonth = useMemo(() => seasonal.filter((s) => s.month === 0), [seasonal]);
  const maxTrend = trending?.length ? Math.max(...trending.map((t) => t.n)) : 1;

  // 바로가기 카드 = 데이터(플래그로 게이팅). 모바일 GNB에서 뺀 화면도 허브에서 항상 도달(docs/48).
  // 호롱 04: 도구 4종은 대형 2×2 — 결재선·업무 한 장·캘린더·기한 사전.
  const tools: Shortcut[] = [
    ...(approvalOn ? [{ icon: "✅", title: "결재선", href: "/approval/",
      desc: "이 업무 전결권자가 누구인지 규정 근거로 판정" }] : []),
    ...(journeyOn ? [{ icon: "🗺️", title: "업무 한 장", href: "/journey/",
      desc: "출장·연차·법인카드 등 13개 업무의 처음부터 끝까지" }] : []),
    { icon: "📅", title: "업무 캘린더", href: "/calendar/",
      desc: `${monthItems.length > 0 ? `이번 달 챙길 일 ${monthItems.length}건 · ` : ""}매월·연간 반복 업무를 한눈에` },
    ...(deadlinesOn ? [{ icon: "⏱️", title: "기한 사전", href: "/deadlines/",
      desc: `규정 기한 ${deadlinesCount}건을 사건·의무로 찾고 마감일 계산·캘린더 저장` }] : []),
    ...(impactOn ? [{ icon: "🧭", title: "개정 영향 분석", href: "/impact/",
      desc: "조문을 고치면 어디를 확인해야 하는지 — 인용·가이드·서식·기한 지도" }] : []),
  ];
  const shortcuts: Shortcut[] = [
    ...(qualityOn ? [{ icon: "📊", title: "품질 게시판", href: "/quality/",
      desc: "매일 자가평가한 오늘의 정답률과 약점 지도 — 챗봇이 얼마나 정확한지" }] : []),
    ...(changelogOn ? [{ icon: "✨", title: "새로워진 점", href: "/changelog/",
      desc: notes[0] ? `최근: ${notes[0].제목}` : "서비스 업데이트 내역" }] : []),
    ...(feedbackOn ? [{ icon: "📮", title: "의견 보내기", href: "/feedback/",
      desc: "원문 오류·빠진 개정본·개선 의견을 제보하고 처리 상태 확인" }] : []),
    // 모바일 셸(docs/54 v2)에선 푸터가 숨어 아래 진입점은 이 허브가 유일 — 데스크톱 허브에도 무해
    { icon: "❓", title: "도움말", href: "/help/", desc: "사용법·FAQ — 처음이라면 여기부터" },
    ...(landingOn ? [{ icon: "🏛️", title: "소개", href: "/about/",
      desc: "이 서비스가 무엇인지, 어떤 규정을 근거로 답하는지" }] : []),
    ...(user?.is_admin ? [{ icon: "🛠️", title: "관리자", href: "/admin/",
      desc: "대시보드·의견함(AI 자동 수정)·통계·기능 플래그" }] : []),
  ];

  if (!on) {
    return (
      <Layout>
        <Head><title>{`업무 도구 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="업무 도구" lead="이 기능은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>{`업무 도구 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="업무 도구" lead="행정 업무 도구와 요즘 흐름을 한곳에 모았어요." />

      {/* ── 호롱 04: 도구 4종 대형 2×2 ── */}
      <h2 className={n.sectionLabel}>도구</h2>
      <div className={n.toolGrid} data-fadeup>
        {tools.map((sc) => <ShortcutCard key={sc.href} {...sc} large />)}
      </div>

      <h2 className={n.sectionLabel}>바로가기</h2>
      <div className={n.shortcutGrid}>
        {shortcuts.map((sc) => <ShortcutCard key={sc.href} {...sc} />)}
      </div>

      {/* ── 요즘 흐름: 인기 키워드 · 최근 개정 · 오늘의 용어 ── */}
      <h2 className={n.sectionLabel}>요즘 흐름</h2>
      <div className={n.grid}>
        {/* 📈 요즘 많이 찾는 키워드 */}
        <section className={n.card} aria-label="요즘 많이 찾는 키워드">
          <h2 className={n.h2}>📈 요즘 많이 찾는 키워드 <span className={n.muted}>(최근 7일)</span></h2>
          {trendErr !== null ? (
            <p className={n.muted}>{trendErr === 401 ? "로그인하면 볼 수 있어요." : "지금은 키워드를 불러올 수 없어요."}</p>
          ) : trending === null ? (
            <p className={n.muted}>불러오는 중…</p>
          ) : trending.length === 0 ? (
            <p className={n.muted}>아직 집계된 키워드가 없어요.</p>
          ) : (
            <ul className={n.trendList}>
              {trending.slice(0, 5).map((t) => (
                <li key={t.k}>
                  <Link href={`/?q=${encodeURIComponent(t.k + " ")}`} className={n.trendLabel}
                    onClick={() => track("trending_click", "/now")}>
                    {t.k}
                  </Link>
                  <span className={n.trendBarWrap}>
                    <span className={n.trendBar} style={{ width: `${Math.max(8, (t.n / maxTrend) * 100)}%` }} />
                  </span>
                  <span className={n.trendN}>{t.n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 📜 최근 개정된 규정 */}
        <section className={n.card} aria-label="최근 개정된 규정">
          <h2 className={n.h2}>📜 최근 개정된 규정</h2>
          <ul className={n.plainList}>
            {revised.map((d) => (
              <li key={d.slug}>
                <Link href={`/d/${encodeURIComponent(d.slug)}/`}>{d.title}</Link>
                <span className={n.muted}> · {d.revised.replace(/-/g, ".")}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 📖 오늘의 용어 */}
        <section className={n.card} aria-label="오늘의 용어">
          <h2 className={n.h2}>📖 오늘의 용어</h2>
          {todayTerm ? (
            <p className={n.termBody}>
              <Link href={`/d/${encodeURIComponent(todayTerm.slug)}/`} className={n.termLink}>
                {todayTerm.title}
              </Link>
              <span className={n.muted}> — 눌러서 뜻을 확인해 보세요. 내일은 다른 용어가 나와요.</span>
            </p>
          ) : (
            <p className={n.muted}>용어집이 비어 있어요.</p>
          )}
        </section>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({
  props: {
    seasonal: loadSeasonal(),
    revised: recentlyRevised(5),
    notes: loadChangelog().slice(0, 3).map(({ id, 제목, 날짜, 분류 }) => ({ id, 제목, 날짜, 분류 })),
    terms: termPool(),
    formsCount: loadForms().length,
    deadlinesCount: loadDeadlines().length,
  },
});
