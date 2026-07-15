import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Login from "./Login";
import ScrollRail, { type RailItem } from "./ScrollRail";
import { api, type User } from "../lib/api";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import styles from "./Landing.module.css";

// 소개(랜딩) 페이지(docs/36, flag landing_page) — x.ai 스타일 스크롤 내러티브.
// variant="full": /about (SSG, 6섹션 + ScrollRail)
// variant="home": 비로그인 '/' 컴팩트 히어로(로그인 카드 우선 — 세션 만료 사용자 마찰 최소)
// ⛔ 데모는 전부 새니타이즈 목업(§5 폴백 ③) — 실규정 텍스트·수치 0. 실영상은 P3(사내 배포 채널).

export type LandingCounts = { regs: number; guides: number; terms: number; reviewed: number };

const RAIL: RailItem[] = [
  { id: "hero", label: "소개" },
  { id: "ask", label: "이렇게 물어보세요" },
  { id: "sources", label: "모든 답에 근거" },
  { id: "explore", label: "둘러보고 연결해서" },
  { id: "trust", label: "믿을 수 있게" },
  { id: "start", label: "시작하기" },
];

// 예시 질문 — 배속 영상은 텍스트를 못 읽으니 학습은 칩이 담당(리뷰 확정). 값·기한 없는 질문만.
const EXAMPLES = ["출장 여비 정산은 어떻게 하나요?", "연차휴가는 어떻게 신청하나요?", "법인카드 사용 원칙이 궁금해요"];

/** IO 리베일 — prefers-reduced-motion이면 CSS가 애니메이션 자체를 정의하지 않는다(§7) */
function useReveal(root: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll("[data-reveal]");
    if (!els?.length) return;
    const io = new IntersectionObserver(
      (ents) => ents.forEach((e) => { if (e.isIntersecting) e.target.classList.add(styles.vis); }),
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

/** 섹션 아이브로 — 애플식 작은 액센트 라벨(컬러 모먼트의 포인트 색) */
function Eyebrow({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <p className={`${styles.eyebrow} ${styles[tone]}`}>{children}</p>;
}

/** 관계 그래프 미니 비주얼 — 노드·엣지 SVG(정적, 커밋 가능). 우리의 가장 강한 시각 자산. */
function GraphVisual() {
  const nodes = [
    { x: 90, y: 60, r: 15, a: "규정집" }, { x: 200, y: 40, r: 10, a: "가이드" },
    { x: 250, y: 120, r: 13, a: "규정집" }, { x: 150, y: 130, r: 18, a: "규정집" },
    { x: 60, y: 150, r: 9, a: "용어집" }, { x: 300, y: 70, r: 8, a: "시스템" },
  ];
  const edges = [[0, 3], [0, 1], [3, 2], [3, 4], [1, 2], [2, 5], [1, 5]];
  const col = (a: string) => `var(--accent-${a})`;
  return (
    <div className={styles.graphViz} aria-hidden>
      <svg viewBox="0 0 340 180" width="100%" height="100%">
        {edges.map(([a, z], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[z].x} y2={nodes[z].y}
            stroke="var(--color-border-strong)" strokeWidth="1.5" />
        ))}
        {nodes.map((nd, i) => (
          <circle key={i} cx={nd.x} cy={nd.y} r={nd.r} fill={col(nd.a)} opacity="0.9" />
        ))}
      </svg>
    </div>
  );
}

/** 채팅 실사용 목업 — UI 형태만 재현(커밋 가능). 답변·출처는 자리표시 문구다. */
function ChatMockup() {
  return (
    <figure className={styles.mock} aria-label="채팅 사용 예시 화면(목업)">
      <div className={styles.mockBar}><span /><span /><span /></div>
      <div className={styles.mockBody}>
        <p className={styles.mockUser}>출장 여비 정산은 어떻게 하나요?</p>
        <div className={styles.mockBot}>
          <p>여비 정산 절차를 규정 근거와 함께 단계별로 안내해요. 금액·한도 같은 수치는 아래 근거의 원문에서 바로 확인할 수 있어요.</p>
          <div className={styles.mockChips}>
            <span className={styles.mockChip}>📜 규정명 제N조</span>
            <span className={styles.mockChip}>📘 업무 가이드</span>
          </div>
          <p className={styles.mockDisclaim}>답변은 참고용이에요 — 최종 확인은 원문으로.</p>
        </div>
      </div>
      <figcaption className={styles.mockCaption}>질문 → 근거가 달린 답변 → 원문 확인 (화면 예시)</figcaption>
    </figure>
  );
}

export default function Landing({
  variant,
  counts,
  onAuthed,
}: {
  variant: "full" | "home";
  counts?: LandingCounts;
  /** 비로그인 게이트에서 로그인 성공 시 채팅으로 전환. /about에서는 미로그인 시에만 폼 노출 */
  onAuthed?: (u: User) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  // /about은 로그인 여부를 모름 — 로그인 상태면 폼 대신 '질문하러 가기'(클라이언트 확인)
  const [me, setMe] = useState<User | null | undefined>(undefined); // undefined=확인 중
  useEffect(() => {
    if (onAuthed) { setMe(null); return; } // 게이트 사용처(비로그인 확정)는 조회 불필요
    api.me().then(setMe).catch(() => setMe(null));
  }, [onAuthed]);

  const goStart = () => {
    const start = document.getElementById("start");
    start?.scrollIntoView({ behavior: "smooth", block: "start" });
    // 접근성(§0-5): CTA는 스크롤 + 포커스 이동까지
    window.setTimeout(() => start?.querySelector("input")?.focus({ preventScroll: true }), 450);
  };

  if (variant === "home") {
    // 컴팩트: 로그인 카드가 첫 화면에 함께 보인다(세션 만료 사용자 2클릭·2탭 이내 — §7)
    return (
      <div className={styles.homeWrap} ref={rootRef}>
        <div className={styles.homeHero}>
          <p className={styles.heroKicker}>KEI 임직원 전용</p>
          <h1 className={styles.homeTitle}>{SITE_NAME}</h1>
          <p className={styles.heroLead}>사내 규정을 근거로 답하는 행정 도우미 — 모든 답변에 출처가 달립니다.</p>
          <div className={styles.exampleChips} aria-label="예시 질문">
            {EXAMPLES.map((q) => <span key={q} className={styles.exChip}>{q}</span>)}
          </div>
          <Link href="/about/" className={styles.aboutLink}>서비스 소개 자세히 보기 →</Link>
        </div>
        <div className={styles.homeLogin}>
          {onAuthed ? <Login onAuthed={onAuthed} embedded /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} ref={rootRef}>
      <ScrollRail items={RAIL} />

      {/* 1. 히어로 — 테마 불변 다크 그라디언트(§0-4) */}
      <section id="hero" className={`${styles.section} ${styles.hero}`}>
        <div className={styles.inner}>
          <p className={styles.heroKicker}>KEI 임직원 전용 · 사내 규정 기반</p>
          <h1 className={styles.heroTitle}>{SITE_NAME}</h1>
          <p className={styles.heroLead}>
            "이 업무, 어떻게 처리하지?" — 규정을 근거로 답하는 행정 도우미.
            <br />모든 답변에 <b>[규정명 제N조]</b> 출처가 달립니다.
          </p>
          <div className={styles.heroCtas}>
            <button type="button" className={styles.ctaPrimary} onClick={goStart}>지금 시작하기</button>
            <a className={styles.ctaGhost} href="#ask">어떻게 쓰는지 보기 ↓</a>
          </div>
        </div>
      </section>

      {/* 2. 이렇게 물어보세요 — 파랑 모먼트 + 채팅 목업 나란히 */}
      <section id="ask" className={`${styles.section} ${styles.mBlue}`}>
        <div className={`${styles.inner} ${styles.split}`} data-reveal>
          <div className={styles.splitText}>
            <Eyebrow tone="tBlue">질문하기</Eyebrow>
            <h2 className={styles.h2}>말하듯 물으면,<br />규정이 답합니다</h2>
            <p className={styles.lead}>어려운 규정 용어를 몰라도 괜찮아요. 평소 말하듯 물어보세요.</p>
            <div className={styles.exampleChips} aria-label="예시 질문">
              {EXAMPLES.map((q) => <span key={q} className={styles.exChip}>{q}</span>)}
            </div>
          </div>
          <div className={styles.splitVisual}><ChatMockup /></div>
        </div>
      </section>

      {/* 3. 모든 답에 근거 + 가드레일 시연(신뢰 자산 1급 — 리뷰 확정) */}
      <section id="sources" className={`${styles.section} ${styles.mGreen}`}>
        <div className={styles.inner} data-reveal>
          <Eyebrow tone="tGreen">근거</Eyebrow>
          <h2 className={styles.h2}>모든 답에<br />근거가 달립니다</h2>
          <p className={styles.lead}>
            답변 옆 근거 패널에서 인용된 조문을 바로 열어볼 수 있고, 금액·한도가 나오면
            원문 수치 확인을 안내합니다. 규정집 기준일({CORPUS_AS_OF})도 항상 표시돼요.
          </p>
          <div className={styles.guardCard}>
            <p className={styles.guardLabel}>그리고 가장 중요한 약속 —</p>
            <p className={styles.guardQuote}>"해당 내용은 규정에서 확인되지 않습니다."</p>
            <p className={styles.guardDesc}>
              근거가 없으면 지어내지 않고 이렇게 답합니다. 아는 것과 모르는 것을 구분하는 것이
              이 서비스의 첫 번째 원칙입니다.
            </p>
          </div>
        </div>
      </section>

      {/* 4. 둘러보고 연결해서 — 보라 모먼트 + 그래프 비주얼 */}
      <section id="explore" className={`${styles.section} ${styles.mPurple}`}>
        <div className={styles.inner} data-reveal>
          <Eyebrow tone="tPurple">둘러보기</Eyebrow>
          <h2 className={styles.h2}>규정은 서로 연결돼 있어요</h2>
          <p className={styles.lead}>하나의 규정에서 관련 규정·가이드·서식으로 자연스럽게 이어집니다.</p>
          <GraphVisual />
          <div className={styles.featGrid}>
            <Link href="/browse/" className={styles.featCard}>
              <span className={styles.featEmoji}>📚</span>
              <b>규정 둘러보기</b>
              <p>규정·가이드·용어를 분류별로 탐색하고 원문을 그대로 읽어요.</p>
            </Link>
            <Link href="/graph/" className={styles.featCard}>
              <span className={styles.featEmoji}>🕸</span>
              <b>관계 그래프</b>
              <p>서로 인용하는 규정들을 연결망으로 — 관련 규정을 한눈에.</p>
            </Link>
            <Link href="/forms/" className={styles.featCard}>
              <span className={styles.featEmoji}>📄</span>
              <b>서식 찾기</b>
              <p>별지 서식을 번호·이름으로 찾아 해당 조문으로 바로 이동해요.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* 5. 믿을 수 있게 — 사용자 언어 실측치만(빌드타임 계산, 리뷰 확정). 주황 모먼트 */}
      <section id="trust" className={`${styles.section} ${styles.mOrange}`}>
        <div className={styles.inner} data-reveal>
          <Eyebrow tone="tOrange">신뢰</Eyebrow>
          <h2 className={styles.h2}>믿을 수 있게 운영합니다</h2>
          {counts ? (
            <div className={styles.statGrid}>
              {/* 값이 0인 지표는 숨긴다 — '0 검수완료'는 신뢰를 되레 깎는다(보안 리뷰 확정, §3-5) */}
              {[
                { n: counts.regs, label: "규정 원문" },
                { n: counts.guides, label: "업무 가이드" },
                { n: counts.terms, label: "행정 용어" },
                { n: counts.reviewed, label: "사람 검수 완료" },
              ].filter((s) => s.n > 0).map((s) => (
                <div key={s.label} className={styles.stat}><b>{s.n.toLocaleString()}</b><span>{s.label}</span></div>
              ))}
            </div>
          ) : null}
          <p className={styles.trustNote}>
            📑 규정집 기준일 {CORPUS_AS_OF} · 답변은 참고용이며 최종 확인은 규정 원문으로 ·
            🔒 사내 전용 — 모든 데이터는 원내 서버에만 있습니다(외부 반출 없음).
          </p>
        </div>
      </section>

      {/* 6. 시작하기 */}
      <section id="start" className={styles.section}>
        <div className={styles.inner} data-reveal>
          <Eyebrow tone="tBlue">시작하기</Eyebrow>
          <h2 className={styles.h2}>3분이면 충분해요</h2>
          <ol className={styles.steps} aria-label="가입 절차">
            <li><b>1</b> KEI 이메일(@kei.re.kr)로 가입</li>
            <li><b>2</b> 메일로 받은 6자리 코드 입력</li>
            <li><b>3</b> 바로 질문 시작</li>
          </ol>
          <p className={styles.stepNote}>인증 메일이 오지 않으면 시스템 관리자에게 문의하세요.</p>
          <div className={styles.startLogin}>
            {me === undefined ? null : me ? (
              <Link href="/" className={styles.ctaPrimary}>이미 로그인됨 — 질문하러 가기 →</Link>
            ) : (
              <Login onAuthed={onAuthed ?? (() => { window.location.href = "/"; })} embedded />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
