import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import { useFlag } from "../lib/flags";
import { api } from "../lib/api";
import { CORPUS_AS_OF } from "../lib/site";
import styles from "./Layout.module.css";

export default function Layout({
  children,
  breadcrumb,
  fill,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  /** true면 페이지를 뷰포트 높이에 고정(전체 스크롤 제거) → 내부 영역만 스크롤(둘러보기/그래프) */
  fill?: boolean;
}) {
  const demoBanner = useFlag("demo_banner"); // 기능 플래그 예시(관리자 페이지에서 토글)
  // 관리자 링크는 관리자에게만 노출(보안은 백엔드 403로 방어되나, 비관리자/로그아웃엔 링크 숨김)
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    api
      .me()
      .then((u) => setIsAdmin(!!u.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);
  return (
    <div className={styles.root} data-fill={fill ? "" : undefined}>
      {demoBanner ? (
        <div className={styles.banner}>🚧 새 기능 미리보기 모드입니다 (기능 플래그 demo_banner)</div>
      ) : null}
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.mark}>KEI</span>
            <span className={styles.brandText}>행정 가이드</span>
          </Link>
          <nav className={styles.nav}>
            <Link href="/">LLM</Link>
            <Link href="/browse/">규정 둘러보기</Link>
            <Link href="/graph/">관계 그래프</Link>
          </nav>
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
        <div className={fill ? styles.innerFill : styles.inner}>{children}</div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <span>KEI 행정 가이드 · 내부 전용 (Cloudflare Zero Trust 뒤) · 인터넷 공개 금지</span>
          <span className={styles.footerRight}>
            <span className={styles.asOf} title="이 날짜 기준의 규정 원문을 근거로 답합니다. 이후 개정은 반영되지 않았을 수 있어요.">
              📑 규정집 기준일 {CORPUS_AS_OF}
            </span>
            {isAdmin ? (
              <Link href="/admin/" className={styles.adminLink}>관리자</Link>
            ) : null}
          </span>
        </div>
      </footer>
    </div>
  );
}
