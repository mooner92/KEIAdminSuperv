import type { ReactNode } from "react";
import styles from "../../styles/Home.module.css";

// 공용 페이지 헤더(2026-07-20) — 거의 모든 페이지가 반복하던 heroCompact(h1+lead) 블록.
// 제목 + 리드 문구를 받아 통일된 컴팩트 히어로를 렌더한다. lead는 노드도 허용(링크·강조 포함).
export default function PageHero({ title, lead, children }: {
  title: string; lead?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className={styles.heroCompact}>
      <h1 className={styles.h1}>{title}</h1>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
      {children}
    </section>
  );
}
