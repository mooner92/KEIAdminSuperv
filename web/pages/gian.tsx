import Head from "next/head";
import Link from "next/link";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import { GianHelper } from "../components/gian";
import { useFlag } from "../lib/flags";
import { loadGianMap } from "../lib/gian";
import type { GianMap } from "../lib/gian";
import { SITE_NAME } from "../lib/site";
import styles from "../styles/Home.module.css";

/**
 * 기안 도우미(docs/72 P4) — 결재선 질문의 나머지 절반("어떻게 쓰지·뭘 첨부·기록물철·협조냐 결재냐").
 * /approval("누가 결재하나")·/travel("얼마 받나")와 같은 계열: 고르면 → 원문 그대로 → 근거 → 면책.
 * 데이터 = tools/index/gian_map.json(01r_gian_map.py, 결정적·LLM 0회)을 빌드타임에 로드
 * (lib/gian.ts, 정적 export라 런타임 fetch 불가).
 * ⛔ 창작 0 — 첨부는 '권장', 기록물철은 '후보', 근거 없는 자리는 "원문 확인".
 */
export default function GianPage({ map }: { map: GianMap }) {
  const on = useFlag("gian_helper");
  return (
    <Layout>
      <Head>
        <title>{`기안 도우미 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <PageHero title="기안 도우미" lead={<>
        업무를 고르면 <b>어떤 문서로 기안하고, 무엇을 첨부하며(권장), 기록물철은 무엇을 고르고,
        협조·결재 역할은 어떻게 나뉘는지</b>를 전자결재 안내 문서와{" "}
        <Link href="/d/6100_문서관리규정/">문서관리규정</Link>·
        <Link href="/d/6120_기록물관리규정/">기록물관리규정</Link> 근거와 함께 보여드려요.
        누가 결재하는지는 <Link href="/approval/">결재선 판정기</Link>에서 더 자세히 볼 수 있습니다.
      </>} />
      {!on ? (
        <p className={styles.lead}>이 기능은 아직 준비 중이에요. (관리자가 켜면 사용할 수 있습니다)</p>
      ) : (
        <GianHelper map={map} />
      )}
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { map: loadGianMap() } });
