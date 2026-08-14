import Head from "next/head";
import Link from "next/link";
import type { GetStaticProps } from "next";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import { TravelCalc } from "../components/travel";
import { useFlag } from "../lib/flags";
import { loadTravelRates } from "../lib/travel";
import type { TravelRates } from "../lib/travel";
import { TRAVEL_REG_SLUG } from "../lib/travelMeta";
import { SITE_NAME } from "../lib/site";
import styles from "../styles/Home.module.css";

/**
 * 여비 계산기(docs/72 P1) — 실사용 질문 1위(출장·여비)를 위한 전용 화면.
 * 결재선 판정기(/approval)와 같은 계열: 입력 → 결정적 표시 → 근거 원문행 → 면책.
 * 데이터 = 여비규정 별표 1·2·3·5 + 제16~18조를 빌드타임에 파싱(lib/travel.ts, 정적 export라 런타임 fetch 불가).
 * ⛔ 금액 창작 0 — 별표에 없는 값은 빈칸 + "원문 확인".
 */
export default function TravelPage({ rates }: { rates: TravelRates }) {
  const on = useFlag("travel_calc");
  return (
    <Layout>
      <Head>
        <title>{`여비 계산기 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <PageHero title="여비 계산기" lead={<>
        직급과 출장 구간을 고르면 <Link href={`/d/${TRAVEL_REG_SLUG}/`}>여비규정</Link> 별표에 적힌{" "}
        <b>일비·숙박비·식비</b>를 원문 그대로 보여드려요. 운임·숙박비는 <b>실비</b>라 금액을 계산하지 않습니다.
        ⚠ 감액·특례(장기체재·업무용 차량 등)는 자동 반영하지 않으니 담당 부서에 확인하세요.
      </>} />
      {!on ? (
        <p className={styles.lead}>이 기능은 아직 준비 중이에요. (관리자가 켜면 사용할 수 있습니다)</p>
      ) : (
        <TravelCalc rates={rates} />
      )}
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = () => ({ props: { rates: loadTravelRates() } });
