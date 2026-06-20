import Link from "next/link";
import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
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
  return (
    <div className={styles.root} data-fill={fill ? "" : undefined}>
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
          KEI 행정 가이드 · 내부 전용 (Cloudflare Zero Trust 뒤) · 인터넷 공개 금지
        </div>
      </footer>
    </div>
  );
}
