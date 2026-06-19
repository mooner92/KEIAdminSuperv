import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchField, SegmentedControl } from "@toss/tds-mobile";
import type { DocMeta, SectionKey } from "../lib/vault";
import styles from "./GuideList.module.css";

type Tab = "전체" | SectionKey;
const TABS: Tab[] = ["전체", "규정집", "가이드", "용어집"];
const LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
};

export default function GuideList({ docs }: { docs: DocMeta[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("전체");

  const counts = useMemo(() => {
    const c: Record<string, number> = { 전체: docs.length };
    for (const d of docs) c[d.section] = (c[d.section] || 0) + 1;
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (tab !== "전체" && d.section !== tab) return false;
      if (!needle) return true;
      return `${d.title} ${d.regNo} ${d.category}`.toLowerCase().includes(needle);
    });
  }, [docs, q, tab]);

  return (
    <div>
      <div className={styles.toolbar}>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          alignment="fluid"
          aria-label="섹션"
        >
          {TABS.map((t) => (
            <SegmentedControl.Item key={t} value={t}>
              {t === "전체" ? "전체" : LABEL[t]} {counts[t] || 0}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <div className={styles.searchWrap}>
          <SearchField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onDeleteClick={() => setQ("")}
            placeholder="제목 · 규정번호 · 분류로 검색"
            aria-label="검색"
          />
        </div>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.count}>{filtered.length}건</span>
      </div>

      <ul className={styles.list}>
        {filtered.map((d) => (
          <li key={d.slug}>
            <Link href={`/d/${d.slug}/`} className={styles.row}>
              <span className={styles.regno}>{d.regNo || "—"}</span>
              <span className={styles.main}>
                <span className={styles.title}>{d.title}</span>
                <span className={styles.sub}>
                  <span className={styles.chip} data-section={d.section}>
                    {LABEL[d.section]}
                  </span>
                  {d.category ? <span className={styles.tag}>{d.category}</span> : null}
                  {d.articleCount > 0 ? (
                    <span className={styles.tag}>{d.articleCount}개 조문</span>
                  ) : null}
                </span>
              </span>
              <span className={styles.right}>
                <span className={styles.date}>{d.revised || "—"}</span>
                <span
                  className={
                    d.reviewed === "검수완료"
                      ? `${styles.badge} ${styles.badgeOk}`
                      : styles.badge
                  }
                >
                  {d.reviewed || "미검수"}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {filtered.length === 0 ? <li className={styles.empty}>검색 결과가 없어요.</li> : null}
      </ul>
    </div>
  );
}
