import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import Section from "../components/common/Section";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";

// 실험실(specs/09) — 정식 승격 전 기능의 무대. 실험 1개 = 플래그 1개.
// ⛔ 등록 게이트(spec §2.5): 졸업 기준을 한 문장으로 못 쓰는 실험은 여기 못 올린다.
//    카드 필수 필드(이름·설명·시작일·졸업 기준·피드백)가 그 게이트의 물질화다.
type Experiment = {
  flag: string; title: string; desc: string; href: string;
  since: string;        // 시작일
  graduation: string;   // 졸업 기준 — 한 문장(빈 값 금지)
};

const EXPERIMENTS: Experiment[] = [
  {
    flag: "lab_code_graph",
    title: "코드 그래프",
    desc: "호롱을 이루는 코드·설계 문서 수천 조각의 연결을 한 장의 지도로 봅니다. " +
      "노드를 클릭하고, 검색하고, 영역별로 필터할 수 있어요.",
    href: "/lab/code-graph/",
    since: "2026-07-31",
    graduation: "한 달간 열람이 꾸준하고 운영 문의가 줄면 정식 코너로 — 아니면 내립니다.",
  },
];

export default function LabPage() {
  const hubOn = useFlag("lab_hub");
  // 훅은 조건 없이 최상위에서 — 실험이 늘면 여기 나란히 추가(현재 1종).
  const codeGraphOn = useFlag("lab_code_graph");
  const flagOn: Record<string, boolean> = { lab_code_graph: codeGraphOn };

  if (!hubOn) {
    return (
      <Layout>
        <Head><title>{`실험실 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="실험실" lead="이 코너는 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }
  const live = EXPERIMENTS.filter((e) => flagOn[e.flag]);
  return (
    <Layout>
      <Head><title>{`실험실 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="실험실 🧪" lead="정식 기능이 되기 전의 시제품들이에요. 언제든 바뀌거나 사라질 수 있어요." />
      {live.length === 0 && (
        <Section icon="🌙" title="지금은 진행 중인 실험이 없어요" desc="새 실험이 열리면 '새로워진 점'에서 알려드릴게요.">
          <p style={{ margin: 0 }}><Link href="/changelog/">새로워진 점 보러 가기 →</Link></p>
        </Section>
      )}
      {live.map((e) => (
        <Section key={e.flag} icon="🧪" title={`${e.title} — 실험 중`} desc={e.desc}>
          <p style={{ margin: "0 0 6px" }}>
            <b>시작</b> {e.since} · <b>졸업 기준</b> {e.graduation}
          </p>
          <p style={{ margin: 0 }}>
            <Link href={e.href}>열어 보기 →</Link>
            {" · "}
            <Link href="/feedback/">의견 보내기</Link>
          </p>
        </Section>
      ))}
    </Layout>
  );
}
