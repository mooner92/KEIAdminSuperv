import Link from "next/link";
import { useEffect, useRef } from "react";
import Login from "./Login";
import { type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import styles from "./Landing.module.css";

// 소개(랜딩) 페이지(docs/36, flag landing_page) — x.ai 스타일 스크롤 내러티브.
// variant="full": /about (SSG, 6섹션 + ScrollRail)
// variant="home": 비로그인 '/' 컴팩트 히어로(로그인 카드 우선 — 세션 만료 사용자 마찰 최소)
// ⛔ 데모는 전부 새니타이즈 목업(§5 폴백 ③) — 실규정 텍스트·수치 0. 실영상은 P3(사내 배포 채널).

export type LandingCounts = { regs: number; guides: number; terms: number; reviewed: number };

// 예시 질문 — 배속 영상은 텍스트를 못 읽으니 학습은 칩이 담당(리뷰 확정). 값·기한 없는 질문만.
const EXAMPLES = ["출장 여비 정산은 어떻게 하나요?", "연차휴가는 어떻게 신청하나요?", "법인카드 사용 원칙이 궁금해요"];

/** IO 리베일 — prefers-reduced-motion이면 CSS가 애니메이션 자체를 정의하지 않는다(§7) */
function useReveal(root: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll("[data-reveal]");
    if (!els?.length) return;
    const io = new IntersectionObserver(
      (ents) => ents.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        // 이중 rAF: 초기 상태(opacity 0)가 최소 1프레임 페인트된 뒤 .vis — 빠른 기기에서
        // 마운트와 같은 프레임에 .vis가 붙어 전환이 통째로 생략되는 레이스 방지(docs/46 §2-9)
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add(styles.vis)));
      }),
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

/** 공용 rAF 스크롤(easeOutCubic) — 네이티브 smooth는 OS '동작 줄이기'에서 즉시 점프로 강등되고
 * 크롬 mandatory 스냅과도 간섭하므로, 스냅을 잠시 끄고 직접 굴린다(docs/47 v2). */
function animateScrollTo(el: HTMLElement, to: number, dur: number, onDone?: () => void) {
  const from = el.scrollTop;
  const prevSnap = el.style.scrollSnapType;
  el.style.scrollSnapType = "none";
  const t0 = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    el.scrollTop = from + (to - from) * ease(k);
    if (k < 1) requestAnimationFrame(step);
    else { el.style.scrollSnapType = prevSnap; onDone?.(); }
  };
  requestAnimationFrame(step);
}

/** 슬라이드 휠(docs/47 v2) — 마우스 휠 1틱(~120px)은 CSS 스냅 임계(슬라이드 절반)를 못 넘어
 * 스냅백된다. 휠을 가로채 한 틱 = 한 슬라이드로 넘긴다(스코어보드 느낌). 터치·키보드는 네이티브 스냅.
 * mandatory 스냅일 때만 개입(낮은 화면 proximity·모바일 일반 스크롤에선 비개입). */
function useSlideWheel(root: React.RefObject<HTMLDivElement>, enabled: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    let animating = false;
    // 자체 rAF 애니메이션(easeOutCubic) — 이유(실측 확정):
    // ① 네이티브 scrollTo(smooth)는 OS '동작 줄이기'에서 브라우저가 즉시 점프로 강등 → '번쩍'.
    //    점수판 전환은 명시적 제품 결정이라 기기 설정과 무관하게 항상 동일하게 재생한다.
    // ② 크롬은 mandatory 스냅 컨테이너에서 smooth를 스냅이 가로채는 이슈가 있어,
    //    애니메이션 동안 스냅을 잠시 끈다(종료 시 정확히 스냅점에 착지시키므로 재보정 없음).
    const animateTo = (to: number) => {
      animating = true;
      animateScrollTo(el, to, 620, () => {
        window.setTimeout(() => { animating = false; }, 60); // 관성 휠 잔여 이벤트 흡수
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // 핀치 줌(Ctrl+휠)은 브라우저에 양보
      // 폴백 모드(낮은 화면 proximity·모바일 스냅 해제) 비개입 — 단 애니메이션 중엔 계속 가로챔
      if (!animating && !getComputedStyle(el).scrollSnapType.includes("mandatory")) return;
      e.preventDefault();
      if (animating || Math.abs(e.deltaY) < 10) return;
      const h = el.clientHeight;
      const cur = Math.round(el.scrollTop / h);
      const max = Math.round((el.scrollHeight - h) / h);
      const next = Math.min(max, Math.max(0, cur + (e.deltaY > 0 ? 1 : -1)));
      if (next === cur) return;
      animateTo(next * h);
    };
    // window 레벨 — 여백·로그인 카드 등 페이지 어디서 굴려도 슬라이드 동작(사용자 요청).
    // 이 페이지는 자체 스크롤이 없어 가로챌 다른 스크롤이 없다. 언마운트 시 해제.
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [root, enabled]);
}

/** 섹션 아이브로 — SpaceX식 모노 넘버링 + 컬러 모먼트 포인트 색(docs/46) */
function Eyebrow({ tone, num, children }: { tone: string; num?: string; children: React.ReactNode }) {
  return (
    <p className={`${styles.eyebrow} ${styles[tone]}`}>
      {num ? <span className={styles.eyebrowNum}>{num}</span> : null}
      {children}
    </p>
  );
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
      <div className={styles.mockBar}><span /><span /><span /><i className={styles.mockTitle}>KEI 행정 가이드 — 질문하기</i></div>
      <div className={styles.mockBody}>
        <p className={styles.mockUser}>출장 여비 정산은 어떻게 하나요?</p>
        <div className={styles.mockBot}>
          <p>여비 정산 절차를 규정 근거와 함께 단계별로 안내해요. 금액·한도 같은 수치는 아래 근거의 원문에서 바로 확인할 수 있어요.<span className={styles.mockCursor} aria-hidden /></p>
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

/** 소개 슬라이드(히어로+01~04) — 통합 홈('/')과 /about이 공유(docs/47 §7 디자인 통일).
 * ctas: /about 히어로에만 CTA 버튼(시작하기 점프)을 끼워 넣는 슬롯. */
function IntroSlides({ counts, ctas }: { counts?: LandingCounts; ctas?: React.ReactNode }) {
  return (
    <>
          {/* 히어로 */}
          <header className={styles.mHero}>
            <p className={styles.heroKicker} data-reveal>
              <span className={styles.liveDot} aria-hidden />
              {SITE_NAME} · KEI 임직원 전용
            </p>
            <h1 className={styles.mTitle} data-reveal>
              물어보면,
              <br />
              <span className={styles.heroGrad}>규정이 답합니다.</span>
            </h1>
            <p className={styles.mLead} data-reveal>
              "이 업무, 어떻게 처리하지?" — 규정을 근거로 답하는 행정 도우미.
              <br />모든 답변에 <b>[규정명 제N조]</b> 출처가 달립니다.
            </p>
            <div className={styles.exampleChips} data-reveal aria-label="예시 질문">
              {EXAMPLES.map((q) => <span key={q} className={styles.exChip}>{q}</span>)}
            </div>
            {counts ? (
              <p className={styles.heroMeta} data-reveal aria-label="코퍼스 규모(빌드타임 실측)">
                {[
                  { n: counts.regs, label: "규정 원문" },
                  { n: counts.guides, label: "업무 가이드" },
                  { n: counts.terms, label: "행정 용어" },
                ].filter((x) => x.n > 0).map((x) => (
                  <span key={x.label}>{x.label} <b>{x.n.toLocaleString()}</b></span>
                ))}
                <span>출처 표기 <b>100%</b></span>
              </p>
            ) : null}
            {ctas}
            <p className={styles.slideCue} aria-hidden>SCROLL ▾</p>
          </header>

          {/* 01 질문하기 */}
          <section className={styles.mSection} data-reveal>
            <Eyebrow tone="tBlue" num="01">질문하기</Eyebrow>
            <h2 className={styles.h2}>말하듯 물으면, 규정이 답합니다</h2>
            <p className={styles.lead}>어려운 규정 용어를 몰라도 괜찮아요. 평소 말하듯 물어보세요.</p>
            <ChatMockup />
          </section>

          {/* 02 근거 */}
          <section className={styles.mSection} data-reveal>
            <Eyebrow tone="tGreen" num="02">근거</Eyebrow>
            <h2 className={styles.h2}>모든 답에 근거가 달립니다</h2>
            <p className={styles.lead}>
              답변 옆 근거 패널에서 인용된 조문을 바로 열어볼 수 있고, 금액·한도가 나오면 원문 확인을 안내합니다.
            </p>
            <div className={styles.guardCard}>
              <p className={styles.guardLabel}>그리고 가장 중요한 약속 —</p>
              <p className={styles.guardQuote}>"해당 내용은 규정에서 확인되지 않습니다."</p>
              <p className={styles.guardDesc}>
                근거가 없으면 지어내지 않고 이렇게 답합니다. 아는 것과 모르는 것을 구분하는 것이 첫 번째 원칙입니다.
              </p>
            </div>
          </section>

          {/* 03 둘러보기 */}
          <section className={styles.mSection} data-reveal>
            <Eyebrow tone="tPurple" num="03">둘러보기</Eyebrow>
            <h2 className={styles.h2}>
              {counts ? (
                <>규정 {counts.regs} · 가이드 {counts.guides} · 용어 {counts.terms} — 전부 연결돼 있습니다.</>
              ) : (
                "규정은 서로 연결돼 있어요"
              )}
            </h2>
            <p className={styles.lead}>하나의 규정에서 관련 규정·가이드·서식으로 자연스럽게 이어집니다.</p>
            <GraphVisual />
            <div className={styles.featGrid}>
              <div className={styles.featCard}><span className={styles.featEmoji}>📚</span><b>규정 둘러보기</b><p>분류별로 탐색하고 원문을 그대로 읽어요.</p></div>
              <div className={styles.featCard}><span className={styles.featEmoji}>🕸</span><b>관계 그래프</b><p>서로 인용하는 규정을 연결망으로 한눈에.</p></div>
              <div className={styles.featCard}><span className={styles.featEmoji}>📄</span><b>서식 찾기</b><p>별지 서식을 번호·이름으로 찾아 바로 이동.</p></div>
            </div>
          </section>

          {/* 04 신뢰 */}
          <section className={styles.mSection} data-reveal>
            <Eyebrow tone="tOrange" num="04">신뢰</Eyebrow>
            <h2 className={styles.h2}>믿을 수 있게 운영합니다</h2>
            {counts ? (
              <div className={styles.statGrid}>
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
              🔒 사내 전용 — 모든 데이터는 원내 서버에만 있습니다.
            </p>
          </section>
    </>
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
  useSlideWheel(rootRef, true); // 두 변형 모두 슬라이드(docs/47 §7 통일)
  // 로그인 여부는 공유 AuthContext에서(단일 출처) — /about start 섹션의 '이미 로그인됨/폼' 분기용.
  // ready 이전엔 undefined(자리표시)로 둬 하이드레이션 안전.
  const { user, ready } = useAuth();
  const me: User | null | undefined = ready ? user : undefined;

  const goStart = () => {
    const el = rootRef.current;
    if (!el) return;
    animateScrollTo(el, el.scrollHeight - el.clientHeight, 750); // 마지막 슬라이드(05 시작하기)로
  };

  if (variant === "home") {
    // 통합 랜딩(docs/47): 소개를 메인으로 — 왼쪽에 소개가 주르륵 스크롤되고,
    // 오른쪽 로그인 카드는 sticky로 제자리에 떠 있다(스크롤해도 이동 X). 소개를 숨기지 않는다.
    return (
      <div className={styles.mergedWrap}>
        <div className={`${styles.mergedIntro} ${styles.page}`} ref={rootRef}>{/* .page = 리빌 CSS 스코프 */}
          <IntroSlides counts={counts} />
        </div>

        {/* 오른쪽 sticky 로그인 — 스크롤해도 제자리 */}
        <aside className={styles.mergedLogin}>
          <div className={styles.loginSticky}>
            {onAuthed ? <Login onAuthed={onAuthed} embedded /> : null}
          </div>
        </aside>
      </div>
    );
  }

  // /about — 통합 홈과 동일한 슬라이드 디자인(로그인 컬럼 없이 단일 컬럼, docs/47 §7).
  // 05 시작하기는 가입 절차 안내 + '/'(로그인)로 보내는 CTA만(폼 없음 — 폼은 통합 홈에 있다).
  return (
    <div className={`${styles.mergedWrap} ${styles.aboutOnly}`}>
      <div className={`${styles.mergedIntro} ${styles.page}`} ref={rootRef}>
        <IntroSlides
          counts={counts}
          ctas={
            <div className={styles.heroCtas} data-reveal>
              <button type="button" className={styles.ctaPrimary} onClick={goStart}>지금 시작하기</button>
            </div>
          }
        />

        {/* 05 시작하기 */}
        <section id="start" className={styles.mSection} data-reveal>
          <Eyebrow tone="tBlue" num="05">시작하기</Eyebrow>
          <h2 className={styles.h2}>1분이면 충분해요</h2>
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
              <Link href="/" className={styles.ctaPrimary}>로그인하고 시작하기 →</Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
