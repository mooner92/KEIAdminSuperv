import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import type { Doc, SectionKey } from "../lib/vault";
import styles from "./DocDrawer.module.css";

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "ERP 시스템",
};

type Backlink = { slug: string; title: string; section: SectionKey };
type DrawerDoc = Doc & { backlinks: Backlink[] };

/**
 * Notion형 문서 드로어 — 목록/그래프/근거카드를 클릭하면 페이지 이동 없이
 * 오른쪽에서 슬라이드인되어 본문을 스크롤로 읽는다.
 * 본문은 out/docdata/<slug>.json 을 지연 로드(빌드타임 산출).
 */
export default function DocDrawer({
  slug,
  anchor: initialAnchor = "",
  highlight = false,
  onClose,
}: {
  slug: string | null;
  anchor?: string;
  /** true면 앵커(인용 조문/별표) 블록을 형광 강조 (cite_highlight 플래그) */
  highlight?: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<string | null>(slug);
  const [anchor, setAnchor] = useState<string>(initialAnchor);
  const [doc, setDoc] = useState<DrawerDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 부모가 여는 slug 변경 → 내부 current 동기화
  useEffect(() => {
    setCurrent(slug);
    setAnchor(initialAnchor);
  }, [slug, initialAnchor]);

  // current 변경 → 본문 JSON 로드
  useEffect(() => {
    if (!current) {
      setDoc(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    fetch(`/docdata/${encodeURIComponent(current)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: DrawerDoc) => {
        if (alive) setDoc(d);
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
  }, [current]);

  // ESC로 닫기 + 열렸을 때 배경 스크롤 잠금
  const open = current != null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // 본문 로드 후 앵커(제N조/별표/별지)로 스크롤, 없으면 맨 위로. highlight면 인용 블록 형광 강조.
  useEffect(() => {
    if (!doc) return;
    const box = scrollRef.current;
    if (!box) return;
    box.querySelectorAll("." + styles.cited).forEach((e) => e.classList.remove(styles.cited)); // 이전 강조 제거
    const id = anchor ? decodeURIComponent(anchor.replace(/^#/, "")) : "";
    const el = id ? box.querySelector(`[id="${CSS.escape(id)}"]`) : null;
    if (!el) {
      box.scrollTop = 0;
      return;
    }
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
    if (highlight) {
      // 앵커 요소부터 다음 조/별표(=id 있는 블록) 직전까지 묶어서 강조(여러 단락·표 포함)
      let cur: Element | null = el;
      while (cur) {
        cur.classList.add(styles.cited);
        const sib: Element | null = cur.nextElementSibling;
        if (!sib || (sib as HTMLElement).id) break;
        cur = sib;
      }
    }
  }, [doc, anchor, highlight]);

  const goInternal = (s: string, a: string) => {
    setCurrent(s);
    setAnchor(a);
  };

  return (
    <div className={`${styles.overlay} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label="문서 보기">
        <div className={styles.bar}>
          <span className={styles.barTitle}>{doc ? doc.title : "문서"}</span>
          <div className={styles.barRight}>
            {current ? (
              <a className={styles.expand} href={`/d/${encodeURIComponent(current)}/`} title="전체 화면으로 열기">
                ↗ 전체화면
              </a>
            ) : null}
            <button className={styles.close} onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>
        </div>

        <div className={styles.scroll} ref={scrollRef}>
          {loading ? <div className={styles.state}>불러오는 중…</div> : null}
          {err ? <div className={styles.state}>{err}</div> : null}
          {doc ? (
            <article className={styles.article}>
              <header className={styles.head}>
                <div className={styles.tags}>
                  <span className={styles.chip} data-section={doc.section}>
                    {SECTION_LABEL[doc.section]}
                  </span>
                  {doc.regNo ? <span className={styles.tag}>규정번호 {doc.regNo}</span> : null}
                  {doc.category ? <span className={styles.tag}>{doc.category}</span> : null}
                  {doc.revised ? <span className={styles.tag}>개정 {doc.revised}</span> : null}
                  <span
                    className={
                      doc.reviewed === "검수완료" ? `${styles.badge} ${styles.badgeOk}` : styles.badge
                    }
                  >
                    {doc.reviewed || "미검수"}
                  </span>
                </div>
                <h1 className={styles.h1}>{doc.title}</h1>
              </header>

              <Markdown source={doc.body} onNavigate={goInternal} />

              {doc.backlinks?.length > 0 ? (
                <aside className={styles.backlinks}>
                  <h2 className={styles.blTitle}>이 문서를 인용한 문서 · {doc.backlinks.length}</h2>
                  <ul className={styles.blList}>
                    {doc.backlinks.map((b) => (
                      <li key={b.slug}>
                        <button onClick={() => goInternal(b.slug, "")}>{b.title}</button>
                      </li>
                    ))}
                  </ul>
                </aside>
              ) : null}
            </article>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
