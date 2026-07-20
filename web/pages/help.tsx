import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import ScrollRail from "../components/common/ScrollRail";
import { useFlag } from "../lib/flags";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import h from "../styles/Help.module.css";

// v1 ⑮(#6) 도움말 + docs/31 도움말 허브(flag help_hub).
// ⛔ 이 페이지에는 규정 값(금액·기한·일수)을 절대 쓰지 않는다 — 사용법·신뢰 원칙만.
// FAQ는 네이티브 <details> 아코디언(기본 접힘) — 초기 로드에 갑작스런 스크롤이 생기지 않는다.

// 목차 섹션 — 상단 가로 칩(모바일)과 우측 스크롤 레일(데스크톱, docs/36 P4) 공용.
// howto·faq는 help_hub on일 때만 렌더되므로 레일 항목도 hubOn으로 필터한다.
const TOC = [
  { id: "intro", label: "소개" },
  { id: "howto", label: "잘 묻는 법", hub: true },
  { id: "limits", label: "한계" },
  { id: "privacy", label: "개인정보" },
  { id: "faq", label: "FAQ", hub: true },
  { id: "contact", label: "문의" },
];

const FAQ: { q: string; a: ReactNode; hidden?: boolean }[] = [
  {
    q: "“규정에서 확인되지 않습니다”가 자꾸 떠요.",
    a: (
      <>
        규정에 근거가 없으면 답하지 않도록 설계돼 있어요(지어내기 방지). 사내에서 쓰는 <b>규정 용어</b>로
        바꿔 다시 물어보세요 — 예: “돈 얼마 줘요?” 대신 “OO수당 지급 기준”. 그래도 없으면 실제로 규정에
        없는 내용일 수 있으니 담당 부서에 문의하세요.
      </>
    ),
  },
  {
    q: "답이 옛 규정 기준인 것 같아요.",
    a: (
      <>
        답변은 화면 하단의 <b>규정집 기준일({CORPUS_AS_OF})</b> 시점 원문을 근거로 해요 — 이후 개정은
        반영되지 않았을 수 있어요. 원문에서 <s>취소선</s>으로 그어진 문구는 개정 전 옛 내용이라는 표시이고,
        챗봇 답변에는 쓰이지 않아요. 최신 여부가 중요하면 담당 부서에서 확인하세요.
      </>
    ),
  },
  {
    q: "답변에 나온 금액을 그대로 써도 되나요?",
    a: (
      <>
        금액·기한이 포함된 답에는 “원문에서 수치 확인” 안내가 함께 떠요. 우측 <b>근거 조문 패널</b>에서
        출처를 눌러 원문(해당 수치가 형광 표시됨)을 직접 확인한 뒤 사용하세요. 회계·감사 관련 수치는
        반드시 담당 부서 확인을 거치는 것을 권장해요.
      </>
    ),
  },
  {
    q: "근거로 나온 표가 이상해요.",
    a: (
      <>
        원문 표가 변환 과정에서 손상된 경우 근거에 <b>⚠ 표 확인</b> 배지가 붙고 답변도 값을 단정하지
        않아요. 근거 패널에서 원문 문서를 열어 표를 직접 확인하고, 이상하면 답변의 <b>👎</b>로
        알려주세요 — 검수 우선순위에 반영돼요.
      </>
    ),
  },
  {
    q: "관리자가 제 대화를 볼 수 있나요?",
    a: (
      <>
        아니요. 관리자에게는 개별 대화를 보는 기능 자체가 없어요. 서로 다른 <b>3명 이상</b>이 물은
        질문·키워드만 익명 집계로 보여요(1~2명만 물은 고유한 질문은 집계에도 나타나지 않아요).
        대화는 사내 서버에만 저장됩니다.
      </>
    ),
  },
  {
    // SMTP 릴레이 개통 전에는 숨김(docs/31 §4.2) — 개통 시 hidden만 제거
    hidden: true,
    q: "인증 메일이 안 와요.",
    a: (
      <>
        재발송은 60초에 한 번 가능해요. 스팸함을 확인하고, 계속 안 오면 시스템 관리자에게 문의하세요.
      </>
    ),
  },
  {
    q: "비밀번호를 잊었어요.",
    a: <>시스템 관리자에게 재설정을 요청하세요. 가입 이메일(아이디)을 알려주시면 돼요.</>,
  },
  {
    q: "답이 틀렸어요. 어떻게 하나요?",
    a: (
      <>
        답변 아래 <b>👎</b>를 누르고 무엇이 틀렸는지 적어주세요. 피드백은 해당 규정 문서의 검수
        우선순위를 끌어올려요 — 자주 지적된 문서부터 사람이 다시 검수하는 <b>자기개선 루프</b>로
        이어집니다. 급한 업무는 담당 부서 확인이 우선이에요.
      </>
    ),
  },
];

export default function Help() {
  const router = useRouter();
  const hubOn = useFlag("help_hub"); // docs/31 — off면 현행 도움말 그대로(안전 기본값)
  const changelogOn = useFlag("changelog"); // docs/32 — 새로워진 점 링크
  const formsOn = useFlag("forms_registry"); // docs/34 ① — 서식 찾기 링크
  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <Layout>
      <Head><title>{`도움말 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      {/* 닫기 동선: 상단 ‹ 뒤로 + 푸터 '도움말 닫기' 토글 — 어디서든 한 번에 복귀 */}
      <button onClick={back} className={h.back}>‹ 뒤로</button>
      <PageHero title="도움말 — 이 도구는 무엇인가요?"
        lead={`${SITE_NAME}는 KEI 사내 규정을 근거로 답하는 내부 전용 지식 도구입니다.`} />

      {hubOn ? (
        <>
          {/* 데스크톱: x.ai 스타일 세로 스크롤 레일(현재 섹션 하이라이트·점프). ≤880px 자동 숨김 */}
          <ScrollRail items={TOC.filter((t) => !t.hub || hubOn)} />
          {/* 모바일/좁은 화면: 상단 가로 칩 목차(레일이 숨는 구간을 커버) */}
          <nav className={h.toc} aria-label="도움말 목차">
            {TOC.filter((t) => !t.hub || hubOn).map((t) => (
              <button key={t.id} className={h.tocChip} onClick={() => jump(t.id)}>{t.label}</button>
            ))}
            {changelogOn ? (
              <Link href="/changelog/" className={h.tocChip}>새로워진 점 ↗</Link>
            ) : null}
          </nav>
        </>
      ) : null}

      <div className={h.body}>
        <section id="intro" className={h.section}>
          <h2>할 수 있는 것</h2>
          <ul>
            <li><b><Link href="/">질문하기</Link></b> — 행정 업무를 물으면 사내 규정·가이드·시스템 안내를 근거(출처)와 함께 답합니다.</li>
            <li><b><Link href="/browse/">규정 둘러보기</Link></b> — 원문 검색·필터, <b><Link href="/graph/">관계 그래프</Link></b> — 규정 간 연결 탐색.</li>
            <li><b><Link href="/approval/">결재선</Link></b> — 위임전결규정 별표 기준 전결권자 조회.</li>
            {formsOn ? <li><b><Link href="/forms/">서식 찾기</Link></b> — 규정 별지 서식을 이름·번호로 검색해 원문으로 바로 이동.</li> : null}
          </ul>
        </section>

        {hubOn ? (
          <section id="howto" className={h.section}>
            <h2>잘 묻는 법</h2>
            <ul>
              <li><b>규정 용어</b>로 물어보세요 — “출장 가서 쓴 돈” 보다 “국내출장 여비 정산”이 잘 찾아요.</li>
              <li><b>한 번에 한 주제</b>만 — 휴가와 출장을 한 질문에 섞으면 근거가 흐려져요.</li>
              <li>상황을 구체적으로 — 대상(본인/가족), 시점, 어떤 절차 단계인지 함께 적어주세요.</li>
              <li>답변 아래 <b>후속 질문 칩</b>과 <b>업무 한 장</b>(전체 절차 지도)을 활용하면 다음 단계를 빠르게 찾아요.</li>
              <li>원문을 읽다가 모르는 구절은 <b>드래그 → “이거 물어보기”</b>로 바로 질문할 수 있어요.</li>
              <li>결재 권한이 궁금하면 채팅보다 <b><Link href="/approval/">결재선</Link></b> 메뉴가 정확해요(별표 기준 조회).</li>
            </ul>
          </section>
        ) : null}

        <section id="limits" className={h.section}>
          <h2>한계 — 꼭 알아두세요</h2>
          <ul>
            <li>답변은 <b>{CORPUS_AS_OF} 기준 규정집</b>을 근거로 자동 생성됩니다 — 이후 개정은 반영되지 않았을 수 있어요.</li>
            <li>“규정에서 확인되지 않습니다”라는 답은 <b>규정에 근거가 없다는 뜻</b>입니다(도구가 지어내지 않도록 설계). 규정 용어로 바꿔 다시 묻거나 담당 부서에 문의하세요.</li>
            <li>금액·기한 등 중요한 수치는 반드시 <b>원문과 담당 부서</b>에서 최종 확인하세요. 대부분의 원문은 자동 변환본(사람 검수 전)입니다.</li>
          </ul>
        </section>

        <section id="privacy" className={h.section}>
          <h2>데이터와 개인정보</h2>
          <ul>
            <li>대화 내용은 <b>사내 서버에만</b> 저장되며 외부로 나가지 않습니다(온프레미스 LLM).</li>
            <li>관리자는 개별 대화 내용을 볼 수 없고, 서로 다른 3명 이상이 물은 질문만 익명 집계로 봅니다.</li>
            <li>더 나은 개선을 위해 <b>기능 사용 횟수</b>(버튼 클릭·페이지 방문 수)를 집계할 수 있어요 —
              무엇을 입력했는지·어떤 문서를 읽었는지는 수집하지 않습니다. 집계를 위해 횟수는
              계정 단위로 저장되지만 관리자에게는 <b>합계만</b> 보이고, 오래된 기록은 자동 삭제됩니다.</li>
          </ul>
        </section>

        {hubOn ? (
          <section id="faq" className={h.section}>
            <h2>자주 묻는 질문 (FAQ)</h2>
            {FAQ.filter((f) => !f.hidden).map((f) => (
              <details key={f.q} className={h.faqItem}
                onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) track("faq_open"); }}>
                <summary>{f.q}</summary>
                <div className={h.faqBody}>{f.a}</div>
              </details>
            ))}
          </section>
        ) : null}

        <section id="contact" className={h.section}>
          <h2>문의</h2>
          <p className={h.contactNote}>비밀번호 재설정·오류 신고: 시스템 관리자에게 요청하세요.</p>
          <p className={h.contactNote}>
            서체: Pretendard GOV(SIL OFL, KRDS 공식 서체) · 디자인: KRDS 참고 자체 구현 ·
            오픈소스 고지는 저장소의 NOTICE 문서를 참고하세요.
          </p>
        </section>
      </div>
    </Layout>
  );
}
