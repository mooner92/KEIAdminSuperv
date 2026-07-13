import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import styles from "../styles/Home.module.css";

// v1 ⑮(#6): 도움말 — 이 도구가 무엇을 하고, 무엇을 못 하는지(한계 고지).
export default function Help() {
  const router = useRouter();
  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));
  return (
    <Layout>
      <Head><title>{`도움말 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      {/* 닫기 동선(사용자 요청): 상단 ‹ 뒤로 + 푸터 '도움말 닫기' 토글 — 어디서든 한 번에 복귀 */}
      <button onClick={back} style={{ background: "none", border: "none", padding: 0, marginBottom: 12,
        color: "var(--color-text-secondary)", fontSize: 14, cursor: "pointer" }}>‹ 뒤로</button>
      <section className={styles.heroCompact}>
        <h1 className={styles.h1}>도움말 — 이 도구는 무엇인가요?</h1>
        <p className={styles.lead}>{SITE_NAME}는 KEI 사내 규정을 근거로 답하는 내부 전용 지식 도구입니다.</p>
      </section>
      <div style={{ maxWidth: 760, lineHeight: 1.7, fontSize: 14.5 }}>
        <h2>할 수 있는 것</h2>
        <ul>
          <li><b><Link href="/">질문하기</Link></b> — 행정 업무를 물으면 사내 규정·가이드·시스템 안내를 근거(출처)와 함께 답합니다.</li>
          <li><b><Link href="/browse/">규정 둘러보기</Link></b> — 원문 검색·필터, <b><Link href="/graph/">관계 그래프</Link></b> — 규정 간 연결 탐색.</li>
          <li><b><Link href="/approval/">결재선</Link></b> — 위임전결규정 별표 기준 전결권자 조회.</li>
        </ul>
        <h2>한계 — 꼭 알아두세요</h2>
        <ul>
          <li>답변은 <b>{CORPUS_AS_OF} 기준 규정집</b>을 근거로 자동 생성됩니다 — 이후 개정은 반영되지 않았을 수 있어요.</li>
          <li>"규정에서 확인되지 않습니다"라는 답은 <b>규정에 근거가 없다는 뜻</b>입니다(도구가 지어내지 않도록 설계). 규정 용어로 바꿔 다시 묻거나 담당 부서에 문의하세요.</li>
          <li>금액·기한 등 중요한 수치는 반드시 <b>원문과 담당 부서</b>에서 최종 확인하세요. 대부분의 원문은 자동 변환본(사람 검수 전)입니다.</li>
        </ul>
        <h2>데이터와 개인정보</h2>
        <ul>
          <li>대화 내용은 <b>사내 서버에만</b> 저장되며 외부로 나가지 않습니다(온프레미스 LLM).</li>
          <li>관리자는 개별 대화 내용을 볼 수 없고, 서로 다른 3명 이상이 물은 질문만 익명 집계로 봅니다.</li>
        </ul>
        <h2>문의</h2>
        <p>비밀번호 재설정·오류 신고: 시스템 관리자에게 요청하세요.</p>
      </div>
    </Layout>
  );
}
