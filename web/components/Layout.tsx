import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Layout.module.css";

export default function Layout({
  children,
  breadcrumb,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.mark}>KEI</span>
            <span className={styles.brandText}>행정 가이드</span>
          </Link>
          <span className={styles.flag}>🔒 사내 전용</span>
        </div>
      </header>
      {breadcrumb ? (
        <nav className={styles.crumbBar} aria-label="breadcrumb">
          <div className={styles.inner}>{breadcrumb}</div>
        </nav>
      ) : null}
      <main className={styles.main}>
        <div className={styles.inner}>{children}</div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.inner}>
          KEI 행정 가이드 · 내부 전용 (Cloudflare Zero Trust 뒤) · 인터넷 공개 금지
        </div>
      </footer>
    </div>
  );
}
