import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import { useFlag } from "../lib/flags";
import { useAuth } from "../lib/auth";
import { BUILD_ID, CORPUS_AS_OF } from "../lib/site";
import { track } from "../lib/track";
import styles from "./Layout.module.css";

export default function Layout({
  children,
  breadcrumb,
  fill,
  bleed,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  /** true면 페이지를 뷰포트 높이에 고정(전체 스크롤 제거) → 내부 영역만 스크롤(둘러보기/그래프) */
  fill?: boolean;
  /** true면 본문을 .inner(max-width) 없이 풀폭 렌더 — 랜딩(docs/36)처럼 섹션이 풀블리드 배경을 가질 때 */
  bleed?: boolean;
}) {
  const router = useRouter();
  const { pathname } = router; // GNB 현재 페이지 표시(v1 ⑩/S5-#15)
  // 도움말 토글(사용자 요청): 도움말에 들어와 있으면 같은 링크가 '닫기'가 되어 이전 화면으로 복귀
  const onHelp = pathname.startsWith("/help");
  const closeHelp = (e: MouseEvent) => {
    if (!onHelp) return;
    e.preventDefault();
    if (window.history.length > 1) router.back();
    else router.push("/");
  };
  const nav = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)) ? styles.navActive : undefined;
  // 업데이트 배너(docs/32): 최신 노트 1건을 한 줄로. X로 닫으면 '그 노트'는 다시 안 뜨고,
  // 새 노트가 나오면 다시 뜬다(localStorage에 마지막으로 닫은 노트 id 저장).
  const changelogOn = useFlag("changelog");
  const [latestNote, setLatestNote] = useState<{ id: string; 요약: string } | null>(null);
  useEffect(() => {
    if (!changelogOn) { setLatestNote(null); return; }
    let alive = true; // 경합 방지: 플래그가 off로 갱신돼 effect가 재실행된 뒤 늦게 도착한 응답 무시
    fetch("/changelog.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const latest = d?.latest;
        if (latest && localStorage.getItem("kei-clog-dismissed") !== latest.id) setLatestNote(latest);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [changelogOn]);
  const dismissNote = () => {
    // 닫기는 항상 성공, 지속 기억은 best-effort(스토리지 차단 환경에서 ✕가 죽지 않게)
    const id = latestNote?.id;
    setLatestNote(null);
    try {
      if (id) localStorage.setItem("kei-clog-dismissed", id);
    } catch { /* 스토리지 불가 — 이번 세션만 닫힘 */ }
  };
  // 배너 실측 높이를 --banner-h로 노출 — 채팅처럼 100vh 공식을 쓰는 화면이 배너만큼 줄어들어
  // 페이지 스크롤이 생기지 않게 한다(요약 줄바꿈 등 높이 변화는 ResizeObserver로 추적).
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = bannerRef.current;
    const set = () => root.style.setProperty("--banner-h", el ? `${el.offsetHeight}px` : "0px");
    set();
    if (!el) return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.setProperty("--banner-h", "0px"); };
  }, [latestNote]);
  const approvalNav = useFlag("approval_finder"); // 결재선 판정기 — 상단 메뉴 노출도 플래그로
  const journeyNav = useFlag("journey_map"); // 업무 한 장(스윔레인) — docs/25
  const helpHub = useFlag("help_hub"); // 도움말 허브·FAQ(docs/31) — 푸터 FAQ 링크 게이트
  const eventsOn = useFlag("events_tab"); // 추가 기능·업무 캘린더(docs/35·41) — GNB 탭
  const landingOn = useFlag("landing_page"); // 소개 페이지(docs/36) — footer '소개' 진입
  // 인증 상태는 공유 AuthContext에서 — 로그인/로그아웃이 여기 반영돼 GNB가 즉시 갱신된다(새로고침 불필요).
  const { user, ready: authKnown } = useAuth();
  const isAuthed = !!user;
  const isAdmin = !!user?.is_admin;
  // 사용량 수집(docs/35 §0): 라우트 단위 page_view — 페이로드 없음, flag off면 서버가 무시.
  // 트리거는 asPath(문서 간 이동도 새 페이지뷰) — 전송값은 라우트 패턴(pathname)이라 slug 미유출.
  // 인증 확인 후에만 발화 — 비로그인 401 노이즈·뮤트 방지(docs/36 §6⑦).
  const { asPath } = router;
  useEffect(() => { if (authKnown) track("page_view", pathname); }, [asPath, pathname, authKnown]);
  return (
    <div className={styles.root} data-fill={fill ? "" : undefined}>
      {latestNote ? (
        <div className={styles.banner} ref={bannerRef}>
          <Link href={`/changelog/#${latestNote.id}`} className={styles.bannerLink}>
            ✨ 새로워진 점: {latestNote.요약} · <u>자세히 →</u>
          </Link>
          <button className={styles.bannerClose} onClick={dismissNote} aria-label="업데이트 알림 닫기">✕</button>
        </div>
      ) : null}
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.mark}>KEI</span>
            <span className={styles.brandText}>행정 가이드</span>
          </Link>
          {/* 앱 메뉴(GNB)는 로그인 후에만 — 비로그인(랜딩/로그인)엔 숨긴다. 인증 확인 전엔 미표시(플래시 방지) */}
          {isAuthed ? (
            <nav className={styles.nav}>
              <Link href="/" className={nav("/")} aria-current={pathname === "/" ? "page" : undefined}>질문하기</Link>
              <Link href="/browse/" className={nav("/browse")} aria-current={pathname.startsWith("/browse") ? "page" : undefined}>규정 둘러보기</Link>
              <Link href="/graph/" className={nav("/graph")} aria-current={pathname.startsWith("/graph") ? "page" : undefined}>관계 그래프</Link>
              {approvalNav ? <Link href="/approval/" className={nav("/approval")} aria-current={pathname.startsWith("/approval") ? "page" : undefined}>결재선</Link> : null}
              {journeyNav ? <Link href="/journey/" className={nav("/journey")} aria-current={pathname.startsWith("/journey") ? "page" : undefined}>업무 한 장</Link> : null}
              {eventsOn ? <Link href="/calendar/" className={nav("/calendar")} aria-current={pathname.startsWith("/calendar") ? "page" : undefined}>업무 캘린더</Link> : null}
              {eventsOn ? <Link href="/now/" className={nav("/now")} aria-current={pathname.startsWith("/now") ? "page" : undefined}>추가 기능</Link> : null}
            </nav>
          ) : (
            <span className={styles.nav} aria-hidden />
          )}
          <div className={styles.headerRight}>
            <ThemeToggle />
            <span className={styles.flag}>🔒 사내 전용</span>
          </div>
        </div>
      </header>
      {breadcrumb ? (
        <nav className={styles.crumbBar} aria-label="breadcrumb">
          <div className={styles.inner}>{breadcrumb}</div>
        </nav>
      ) : null}
      <main className={fill ? styles.mainFill : styles.main}>
        {bleed ? children : <div className={fill ? styles.innerFill : styles.inner}>{children}</div>}
      </main>
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <span>KEI 행정 가이드 · 내부 전용 (Cloudflare Zero Trust 뒤) · 인터넷 공개 금지</span>
          <span className={styles.footerRight}>
            <span className={styles.asOf} title="이 날짜 기준의 규정 원문을 근거로 답합니다. 이후 개정은 반영되지 않았을 수 있어요.">
              📑 규정집 기준일 {CORPUS_AS_OF}
            </span>
            <Link href="/help/" className={styles.adminLink} onClick={closeHelp}
              aria-pressed={onHelp}>{onHelp ? "✕ 도움말 닫기" : "도움말"}</Link>
            {helpHub ? <Link href="/help/#faq" className={styles.adminLink}>FAQ</Link> : null}
            {landingOn ? <Link href="/about/" className={styles.adminLink}>소개</Link> : null}
            {/* 서식 찾기·새로워진 점은 '추가 기능'(/now) 허브로 이전(docs/41) — 푸터 정리 */}
            <span className={styles.asOf} title="배포 빌드 식별자">v.{BUILD_ID}</span>
            {isAdmin ? (
              <Link href="/admin/" className={styles.adminLink}>관리자</Link>
            ) : null}
          </span>
        </div>
      </footer>
    </div>
  );
}
