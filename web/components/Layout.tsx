import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import ThemeToggle from "./common/ThemeToggle";
import HorongMark from "./common/HorongMark";
import AccountMenu from "./common/AccountMenu";
import MobileTabBar from "./mobile/MobileTabBar";
import { IconChat, IconSearch, IconGrid, IconCalendar, IconCheck, IconShield, IconDoc, IconSend, IconPlus } from "./common/icons";
import { useFlag } from "../lib/flags";
import { useAuth } from "../lib/auth";
import { api, type ChatMeta } from "../lib/api";
import { BUILD_ID, CORPUS_AS_OF } from "../lib/site";
import { track } from "../lib/track";
import styles from "./Layout.module.css";

/* 호롱 v2 앱 셸(design/horong-v2, feat/spotify-v2) — Spotify식 플로팅 패널 구조.
 *   [사이드바 288px: 내비 패널 + 대화 라이브러리 패널] + [메인 패널(상단바 + 콘텐츠)]
 * 상단 GNB·유리 헤더·하단 푸터는 폐기 — 그 정보(기준일·빌드ID·도움말·의견…)는
 * 사이드바 보조 내비와 사이드바 푸터로 이동. 라우트는 전부 보존.
 * 비로그인: 사이드바 없이 풀블리드(랜딩이 자체 구성 — 사용자 확정 "소개는 유지").
 *
 * 대화 라이브러리: 목록 fetch는 여기(전역)서, 선택은 `/?chat=<id>`로 ChatApp에 전달.
 * ⚠ 갱신 신호: ChatApp이 대화 생성·삭제·제목변경 시 'kei-chats-changed' 이벤트를 쏘면 재로드(PR3).
 */

/** 분류색 6종 순환 — 라이브러리 커버 타일(콘텐츠의 색, Spotify 앨범아트 역할) */
const COVER_ACCENTS = ["규정집", "가이드", "용어집", "시스템", "대외업무", "상위법령"];

export default function Layout({
  children,
  breadcrumb,
  fill,
  bleed,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  /** true면 콘텐츠를 메인 패널 높이에 고정(내부 영역만 스크롤 — 둘러보기/그래프/채팅) */
  fill?: boolean;
  /** true면 본문을 .inner(max-width) 없이 풀폭 렌더 */
  bleed?: boolean;
}) {
  const router = useRouter();
  const { pathname, asPath } = router;
  const onHelp = pathname.startsWith("/help");
  const closeHelp = (e: MouseEvent) => {
    if (!onHelp) return;
    e.preventDefault();
    if (window.history.length > 1) router.back();
    else router.push("/");
  };
  const nav = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)) ? `${styles.navItem} ${styles.navActive}` : styles.navItem;

  const changelogOn = useFlag("changelog");
  const approvalNav = useFlag("approval_finder");
  const travelNav = useFlag("travel_calc"); // docs/72 P1: 여비 계산기
  const gianNav = useFlag("gian_helper");   // docs/72 P4: 기안 도우미
  const helpHub = useFlag("help_hub");
  const eventsOn = useFlag("events_tab");
  const landingOn = useFlag("landing_page");
  const brandOn = useFlag("brand_page");
  const feedbackOn = useFlag("feedback_center");
  const mobileShellOn = useFlag("mobile_shell");
  const { user, ready: authKnown } = useAuth();
  const isAuthed = !!user;
  const isAdmin = !!user?.is_admin;

  useEffect(() => { if (authKnown) track("page_view", pathname); }, [asPath, pathname, authKnown]);

  // ── 새로워진 점(구 상단 배너) — v2에서 사이드바 하단 카드로 이동 ──
  const [latestNote, setLatestNote] = useState<{ id: string; 요약: string } | null>(null);
  useEffect(() => {
    if (!changelogOn) { setLatestNote(null); return; }
    let alive = true;
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
    const id = latestNote?.id;
    setLatestNote(null);
    try { if (id) localStorage.setItem("kei-clog-dismissed", id); } catch { /* 세션 한정 닫힘 */ }
  };

  // ── 유지보수 알림(관리자) — 벨은 상단바 우측 유지 ──
  const [maintUnread, setMaintUnread] = useState(0);
  useEffect(() => {
    if (!isAdmin || !feedbackOn) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.maintNotices();
        if (stop) return;
        setMaintUnread(r.unread);
        const latest = r.notices.find((n) => n.unread);
        if (latest && typeof Notification !== "undefined" && Notification.permission === "granted") {
          const seen = localStorage.getItem("kei-maint-notified");
          if (seen !== String(latest.id)) {
            localStorage.setItem("kei-maint-notified", String(latest.id));
            try { new Notification("KEI 행정 가이드 — 유지보수 계획", { body: latest.summary, tag: "kei-maint" }); } catch { /* 배지로 충분 */ }
          }
        }
      } catch { /* 다음 주기 */ }
    };
    poll();
    const t = setInterval(poll, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(t); };
  }, [isAdmin, feedbackOn]);

  // ── 사이드바 접기(v2 피드백: "너무 커서 메인에 집중이 안 된다") — 아이콘 레일로 축소 ──
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("kei-sidebar") === "collapsed"); } catch { /* 기본 펼침 */ }
  }, []);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("kei-sidebar", c ? "open" : "collapsed"); } catch { /* 세션 한정 */ }
      return !c;
    });
  };

  // ── 대화 라이브러리(사이드바 패널 B) ──
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const activeChat = pathname === "/" ? Number(router.query.chat) || null : null;
  useEffect(() => {
    if (!isAuthed) { setChats([]); return; }
    let alive = true;
    const load = () => api.listChats().then((l) => { if (alive) setChats(l); }).catch(() => {});
    load();
    // ChatApp이 생성·삭제·제목변경 시 쏘는 갱신 신호(동일 데이터 두 곳 렌더의 동기화 계약)
    const h = () => load();
    window.addEventListener("kei-chats-changed", h);
    return () => { alive = false; window.removeEventListener("kei-chats-changed", h); };
  }, [isAuthed]);

  const removeChat = async (id: number, e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("이 대화를 삭제할까요?")) return;
    try {
      await api.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      window.dispatchEvent(new Event("kei-chats-changed"));
      if (activeChat === id) router.push("/?new=1"); // 보고 있던 대화면 새 대화로
    } catch { /* 실패 시 목록 유지 */ }
  };

  const mshell = mobileShellOn && isAuthed;

  // 비로그인 — 사이드바 없음. ⚠ 랜딩/로그인 그리드는 구 셸의 .inner(max-width) 래퍼에
  // 의존한다 — v2 초기에 래퍼를 빼먹어 히어로가 뷰포트 전폭으로 흩어졌다(실측). bleed면 풀블리드.
  if (!isAuthed) {
    return (
      <div className={styles.anonRoot}>
        <div className={styles.anonTheme}><ThemeToggle /></div>
        <main className={styles.anonMain}>
          {bleed ? children : <div className={styles.inner}>{children}</div>}
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root} data-fill={fill ? "" : undefined} data-mshell={mshell ? "" : undefined} data-collapsed={collapsed ? "" : undefined}>
      {/* ── 사이드바 ── */}
      <aside className={styles.sidebar}>
        {/* 패널 A — 내비 */}
        <div className={styles.panelNav}>
          <div className={styles.brandRow}>
            <Link href="/" className={styles.brand}>
              <HorongMark size={26} />
              <span className={styles.brandText}>호롱</span>
              <span className={styles.brandSub}>KEI 행정 가이드</span>
            </Link>
            <button type="button" className={styles.collapseBtn} onClick={toggleSidebar}
              title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
              aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={!collapsed}>
              {collapsed ? "»" : "«"}
            </button>
          </div>
          <nav className={styles.nav} aria-label="주 메뉴">
            <Link href="/" className={nav("/")} aria-current={pathname === "/" ? "page" : undefined} title="질문하기">
              <IconChat /><span>질문하기</span>
            </Link>
            <Link href="/browse/" className={nav("/browse")} aria-current={pathname.startsWith("/browse") ? "page" : undefined} title="문서 찾기">
              <IconSearch /><span>문서 찾기</span>
            </Link>
            {eventsOn ? (
              <Link href="/now/" className={nav("/now")} aria-current={pathname.startsWith("/now") ? "page" : undefined} title="업무 도구">
                <IconGrid /><span>업무 도구</span>
              </Link>
            ) : null}
          </nav>
          <div className={styles.navRule} role="separator" />
          <nav className={styles.subNav} aria-label="보조 메뉴">
            {eventsOn ? <Link href="/calendar/" className={nav("/calendar")}><IconCalendar size={17} /><span>업무 캘린더</span></Link> : null}
            {approvalNav ? <Link href="/approval/" className={nav("/approval")}><IconCheck size={17} /><span>결재선 판정기</span></Link> : null}
            {travelNav ? <Link href="/travel/" className={nav("/travel")}><IconCalendar size={17} /><span>여비 계산기</span></Link> : null}
            {gianNav ? <Link href="/gian/" className={nav("/gian")}><IconDoc size={17} /><span>기안 도우미</span></Link> : null}
            <Link href="/help/" className={nav("/help")} onClick={closeHelp} aria-pressed={onHelp}>
              <IconDoc size={17} /><span>{onHelp ? "도움말 닫기" : "도움말"}</span>
            </Link>
            {feedbackOn ? <Link href="/feedback/" className={nav("/feedback")}><IconSend size={17} /><span>의견 보내기</span></Link> : null}
            {isAdmin ? <Link href="/admin/" className={nav("/admin")}><IconShield size={17} /><span>관리자</span></Link> : null}
          </nav>
        </div>

        {/* 패널 B — 대화 라이브러리 */}
        <div className={styles.panelLib}>
          <div className={styles.libHead}>
            <span className={styles.libTitle}>대화</span>
            <Link href="/?new=1" className={styles.libNew} aria-label="새 대화" title="새 대화"><IconPlus size={15} /></Link>
          </div>
          <ul className={styles.libList}>
            {chats.map((c, i) => (
              <li key={c.id}>
                <Link
                  href={`/?chat=${c.id}`}
                  className={activeChat === c.id ? `${styles.libRow} ${styles.libRowActive}` : styles.libRow}
                >
                  <span
                    className={styles.libCover}
                    style={{ background: `color-mix(in srgb, var(--accent-${COVER_ACCENTS[i % COVER_ACCENTS.length]}) 18%, transparent)`, color: `var(--accent-${COVER_ACCENTS[i % COVER_ACCENTS.length]})` }}
                    aria-hidden
                  >
                    {(c.title || "새").slice(0, 1)}
                  </span>
                  <span className={styles.libName}>{c.title || "새 대화"}</span>
                  <button type="button" className={styles.libDel} onClick={(e) => removeChat(c.id, e)}
                    title="대화 삭제" aria-label={`대화 삭제: ${c.title || "새 대화"}`}>✕</button>
                </Link>
              </li>
            ))}
            {chats.length === 0 ? <li className={styles.libEmpty}>아직 대화가 없어요</li> : null}
          </ul>
          {latestNote ? (
            <div className={styles.noteCard}>
              <Link href={`/changelog/#${latestNote.id}`} className={styles.noteLink}>✨ {latestNote.요약}</Link>
              <button className={styles.noteClose} onClick={dismissNote} aria-label="업데이트 알림 닫기">✕</button>
            </div>
          ) : null}
          <div className={styles.libFoot}>
            <span title="이 날짜 기준의 행정 문서 원문을 근거로 답합니다.">문서 기준일 {CORPUS_AS_OF}</span>
            <span className={styles.libFootRow}>
              {brandOn ? <Link href="/brand/">브랜드</Link> : null}
              {landingOn ? <Link href="/about/">소개</Link> : null}
              {helpHub ? <Link href="/help/#faq">FAQ</Link> : null}
              <span title="배포 빌드 식별자">v.{BUILD_ID}</span>
            </span>
          </div>
        </div>
      </aside>

      {/* ── 메인 패널 ── */}
      <div className={styles.mainPanel}>
        <div className={styles.topbar}>
          {/* 전역 검색 폐지(2026-07-28 사용자 피드백): 채팅 입력창과 혼동되고,
              문서 찾기 화면에 자체 검색이 있어 중복이었다. 상단바는 상태 표시만 남긴다. */}
          <div className={styles.topRight}>
            {isAdmin && feedbackOn && maintUnread > 0 ? (
              <Link href="/admin/#reports" className={styles.maintBell}
                title={`유지보수 알림 ${maintUnread}건 — 의견함에서 확인`} aria-label={`유지보수 알림 ${maintUnread}건`}>
                🔔<span className={styles.maintBadge}>{maintUnread}</span>
              </Link>
            ) : null}
            <span className={styles.flag}>사내 전용</span>
            <AccountMenu />
          </div>
        </div>
        {breadcrumb ? (
          <nav className={styles.crumbBar} aria-label="breadcrumb">{breadcrumb}</nav>
        ) : null}
        <main className={fill ? styles.mainFill : styles.main}>
          {bleed ? children : <div className={fill ? styles.innerFill : styles.inner}>{children}</div>}
        </main>
      </div>
      {mshell ? <MobileTabBar /> : null}
    </div>
  );
}
