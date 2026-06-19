import { useMemo, useState } from "react";
import { ColorSchemeArea, SearchField } from "@toss/tds-mobile";
import type { DocMeta, SectionKey } from "../lib/vault";
import { useTheme } from "../lib/theme";
import DocDrawer from "./DocDrawer";
import styles from "./Explorer.module.css";

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "ERP 시스템",
};
const SECTIONS: SectionKey[] = ["규정집", "가이드", "용어집", "시스템"];
const REVIEWED = ["검수완료", "미검수"];

const reviewedOf = (d: DocMeta) => (d.reviewed === "검수완료" ? "검수완료" : "미검수");

type Filters = { section: Set<string>; category: Set<string>; reviewed: Set<string> };

/**
 * 규정 둘러보기 — 좌측 체크박스 필터(섹션·분류·검수상태) + 검색 + 결과 목록.
 * 행을 클릭하면 페이지 이동 없이 우측 Notion형 드로어로 본문을 연다.
 */
export default function Explorer({ docs }: { docs: DocMeta[] }) {
  const { resolved } = useTheme();
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ section: new Set(), category: new Set(), reviewed: new Set() });
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  // 분류 목록(데이터에서 도출)
  const categories = useMemo(
    () => Array.from(new Set(docs.map((d) => d.category).filter(Boolean))).sort(),
    [docs]
  );

  // 한 그룹을 제외한 나머지 필터 + 검색을 통과하는지(패싯 카운트/결과용)
  const passes = (d: DocMeta, exclude?: keyof Filters) => {
    const needle = q.trim().toLowerCase();
    if (needle && !`${d.title} ${d.regNo} ${d.category}`.toLowerCase().includes(needle)) return false;
    if (exclude !== "section" && f.section.size && !f.section.has(d.section)) return false;
    if (exclude !== "category" && f.category.size && !f.category.has(d.category)) return false;
    if (exclude !== "reviewed" && f.reviewed.size && !f.reviewed.has(reviewedOf(d))) return false;
    return true;
  };

  const filtered = useMemo(() => docs.filter((d) => passes(d)), [docs, q, f]);

  // 패싯 카운트(다른 필터를 반영한 각 옵션의 건수)
  const countFor = (group: keyof Filters, value: string) =>
    docs.filter((d) => {
      if (!passes(d, group)) return false;
      if (group === "section") return d.section === value;
      if (group === "category") return d.category === value;
      return reviewedOf(d) === value;
    }).length;

  const toggle = (group: keyof Filters, value: string) =>
    setF((prev) => {
      const next = new Set(prev[group]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...prev, [group]: next };
    });

  const activeCount = f.section.size + f.category.size + f.reviewed.size;
  const reset = () => setF({ section: new Set(), category: new Set(), reviewed: new Set() });

  const Check = ({ group, value, label }: { group: keyof Filters; value: string; label: string }) => {
    const n = countFor(group, value);
    const checked = f[group].has(value);
    return (
      <label className={`${styles.check} ${n === 0 && !checked ? styles.checkMuted : ""}`}>
        <input type="checkbox" checked={checked} onChange={() => toggle(group, value)} />
        <span className={styles.checkLabel}>{label}</span>
        <span className={styles.checkCount}>{n}</span>
      </label>
    );
  };

  return (
    <div className={styles.wrap}>
      <aside className={styles.side}>
        <div className={styles.sideHead}>
          <span className={styles.sideTitle}>필터</span>
          {activeCount > 0 ? (
            <button className={styles.reset} onClick={reset}>
              초기화 {activeCount}
            </button>
          ) : null}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>구분</div>
          {SECTIONS.map((s) => (
            <Check key={s} group="section" value={s} label={SECTION_LABEL[s]} />
          ))}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>분류</div>
          <div className={styles.scrollGroup}>
            {categories.map((c) => (
              <Check key={c} group="category" value={c} label={c} />
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>검수상태</div>
          {REVIEWED.map((r) => (
            <Check key={r} group="reviewed" value={r} label={r} />
          ))}
        </div>
      </aside>

      <section className={styles.content}>
        <div className={styles.searchWrap}>
          <ColorSchemeArea theme={resolved}>
            <SearchField
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onDeleteClick={() => setQ("")}
              placeholder="제목 · 규정번호 · 분류로 검색"
              aria-label="검색"
            />
          </ColorSchemeArea>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.count}>{filtered.length}건</span>
        </div>

        <ul className={styles.list}>
          {filtered.map((d) => (
            <li key={d.slug}>
              <button className={styles.row} onClick={() => setOpenSlug(d.slug)}>
                <span className={styles.regno}>{d.regNo || "—"}</span>
                <span className={styles.main}>
                  <span className={styles.title}>{d.title}</span>
                  <span className={styles.sub}>
                    <span className={styles.chip} data-section={d.section}>
                      {SECTION_LABEL[d.section]}
                    </span>
                    {d.category ? <span className={styles.tag}>{d.category}</span> : null}
                    {d.articleCount > 0 ? <span className={styles.tag}>{d.articleCount}개 조문</span> : null}
                  </span>
                </span>
                <span className={styles.right}>
                  <span className={styles.date}>{d.revised || "—"}</span>
                  <span
                    className={
                      d.reviewed === "검수완료" ? `${styles.badge} ${styles.badgeOk}` : styles.badge
                    }
                  >
                    {d.reviewed || "미검수"}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? <li className={styles.empty}>조건에 맞는 문서가 없어요.</li> : null}
        </ul>
      </section>

      <DocDrawer slug={openSlug} onClose={() => setOpenSlug(null)} />
    </div>
  );
}
