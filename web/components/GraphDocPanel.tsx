import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import type { Doc, SectionKey } from "../lib/vault";
import styles from "../styles/Graph.module.css";

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "ERP 시스템",
};
type Backlink = { slug: string; title: string; section: SectionKey };
type PanelDoc = Doc & { backlinks: Backlink[] };

/**
 * 관계 그래프 분할 뷰의 인라인 문서 패널 — 모달(DocDrawer)과 달리 오버레이/백드롭 없이
 * 그래프와 '같은 레이어'에 나란히 표시된다. 그래프는 계속 조작 가능, 다른 노드를 클릭하면 패널만 갱신.
 * 본문 내부 문서 링크 클릭은 onSelect로 가로채 그래프를 떠나지 않고 패널만 전환.
 */
export default function GraphDocPanel({
  slug,
  onSelect,
  onClose,
}: {
  slug: string;
  onSelect: (slug: string) => void;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PanelDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    setDoc(null);
    fetch(`/docdata/${encodeURIComponent(slug)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: PanelDoc) => {
        if (!alive) return;
        setDoc(d);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      })
      .catch(() => {
        if (alive) setErr("문서를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  return (
    <aside className={styles.docPanel} aria-label="문서 보기">
      <div className={styles.docBar}>
        <span className={styles.docTitle}>{doc ? doc.title : "문서"}</span>
        <div className={styles.docBarRight}>
          <a className={styles.docExpand} href={`/d/${encodeURIComponent(slug)}/`} title="전체 화면으로 열기">
            ↗ 전체화면
          </a>
          <button className={styles.docClose} onClick={onClose} aria-label="패널 닫기">
            ✕
          </button>
        </div>
      </div>
      <div className={styles.docScroll} ref={scrollRef}>
        {loading ? <div className={styles.docState}>불러오는 중…</div> : null}
        {err ? <div className={styles.docState}>{err}</div> : null}
        {doc ? (
          <article className={styles.docArticle}>
            <div className={styles.docChips}>
              <span className={styles.docChip} data-section={doc.section}>
                {SECTION_LABEL[doc.section] || doc.section}
              </span>
              {doc.regNo ? <span className={styles.docChip}>규정번호 {doc.regNo}</span> : null}
              {doc.category ? <span className={styles.docChip}>{doc.category}</span> : null}
              {doc.revised ? <span className={styles.docChip}>개정 {doc.revised}</span> : null}
              <span className={`${styles.docChip} ${doc.reviewed === "검수완료" ? styles.docChipOk : styles.docChipWarn}`}>
                {doc.reviewed || "미검수"}
              </span>
            </div>
            <h1 className={styles.docH1}>{doc.title}</h1>
            <Markdown source={doc.body} onNavigate={(s) => onSelect(s)} />
            {doc.backlinks?.length > 0 ? (
              <aside className={styles.docBacklinks}>
                <h2 className={styles.docBlTitle}>이 문서를 인용한 문서 · {doc.backlinks.length}</h2>
                <ul className={styles.docBlList}>
                  {doc.backlinks.map((b) => (
                    <li key={b.slug}>
                      <button onClick={() => onSelect(b.slug)}>{b.title}</button>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </article>
        ) : null}
      </div>
    </aside>
  );
}
