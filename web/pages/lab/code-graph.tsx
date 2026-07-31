import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import Layout from "../../components/Layout";
import PageHero from "../../components/common/PageHero";
import { useFlag } from "../../lib/flags";
import { SITE_NAME } from "../../lib/site";

// 실험 1호: 코드 그래프(specs/09 §2.6) — server.js가 직서빙하는 게시본을 iframe으로.
// 게시본은 scripts/graphify-refresh.sh --publish 가 유출 검사 통과분만 갱신한다.
// 기준 커밋·날짜 표기 = CORPUS_AS_OF와 같은 정직성 장치(썩은 그래프를 최신인 척 안 한다).
type Meta = { commit?: string; generated?: string; nodes?: number };

export default function CodeGraphPage() {
  const on = useFlag("lab_code_graph");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [missing, setMissing] = useState(false); // 게시본 미존재(아직 --publish 전)

  useEffect(() => {
    if (!on) return;
    fetch("/lab-assets/code-graph.meta.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setMeta)
      .catch(() => setMissing(true));
  }, [on]);

  if (!on) {
    return (
      <Layout>
        <Head><title>{`코드 그래프 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="코드 그래프" lead="이 실험은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }
  return (
    <Layout>
      <Head><title>{`코드 그래프 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero
        title="코드 그래프 🧪"
        lead="호롱을 이루는 코드와 설계 문서의 연결 지도예요. 노드를 클릭·검색하고 영역별로 필터해 보세요."
      />
      <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.75 }}>
        {meta ? <>그래프 기준: <code>{meta.commit}</code> · {meta.generated}{meta.nodes ? <> · 노드 {meta.nodes.toLocaleString()}개</> : null}</>
          : missing ? "아직 게시된 그래프가 없어요 — 관리자에게 문의해 주세요." : "그래프 정보를 불러오는 중…"}
        {" · "}
        <a href="/lab-assets/code-graph.html" target="_blank" rel="noreferrer">새 탭에서 크게 보기 ↗</a>
        {" · "}
        <Link href="/lab/">실험실로 ←</Link>
      </p>
      {!missing && (
        <iframe
          src="/lab-assets/code-graph.html"
          title="호롱 코드 그래프"
          style={{ width: "100%", height: "78vh", border: "1px solid var(--border, #e5e2da)", borderRadius: 12, background: "#fff" }}
        />
      )}
    </Layout>
  );
}
