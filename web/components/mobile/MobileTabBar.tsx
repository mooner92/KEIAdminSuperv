import Link from "next/link";
import { useRouter } from "next/router";
import m from "./MobileTabBar.module.css";

// 모바일 하단 탭바(docs/54 v2) — ≤640px 전용 내비(상단 GNB 대체). flag mobile_shell.
// 설계: 유저 사용의 ~90%가 채팅 → 첫 탭. 부가기능은 전부 ☰ 더보기(/now)로 몰아 화면을 비운다.
// Expo 대비: 탭을 데이터(MOBILE_TABS)로 분리 — 추후 React Navigation 탭으로 1:1 매핑 가능.
export type MobileTab = {
  key: string;
  icon: string;
  label: string;
  href: string;
  /** 이 프리픽스 중 하나로 시작하면 활성(더보기는 부가 화면 전체를 커버) */
  match: string[];
};

export const MOBILE_TABS: MobileTab[] = [
  { key: "chat", icon: "💬", label: "질문", href: "/", match: ["/"] },
  { key: "browse", icon: "📚", label: "문서", href: "/browse/", match: ["/browse", "/d/"] },
  {
    key: "more", icon: "☰", label: "더보기", href: "/now/",
    match: ["/now", "/graph", "/calendar", "/forms", "/approval", "/journey", "/travel",
      "/changelog", "/feedback", "/help", "/about", "/admin"],
  },
];

function isActive(t: MobileTab, pathname: string): boolean {
  if (t.href === "/") return pathname === "/";
  return t.match.some((p) => pathname.startsWith(p));
}

export default function MobileTabBar() {
  const { pathname } = useRouter();
  return (
    <nav className={m.bar} aria-label="모바일 메뉴">
      {MOBILE_TABS.map((t) => {
        const on = isActive(t, pathname);
        return (
          <Link key={t.key} href={t.href} className={`${m.tab} ${on ? m.on : ""}`}
            aria-current={on ? "page" : undefined}>
            <span className={m.icon} aria-hidden>{t.icon}</span>
            <span className={m.label}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
