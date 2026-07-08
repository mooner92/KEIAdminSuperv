import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import type { Doc, SectionKey } from "../lib/vault";
import { useFlag } from "../lib/flags";
import DeadlineList, { type Deadline } from "./DeadlineCalc";
import styles from "./DocDrawer.module.css";

// Track A(조문 정제) 슬라이스 — 빌드타임 emit-docdata가 부착
type TrackA = {
  deleted: { 조: string; 삭제일: string }[];
  added: { 조: string; 신설일: string }[];
  crossRefs: { from: string; toName: string; toSlug: string; toJo: string; rel: string }[];
  defs: { 조: string; term: string; 정의: string }[];
};
// Track C(그래프 분석) 슬라이스
type TrackC = {
  impactedBy: { name: string; slug: string; hop: number }[];
  coCited: { name: string; slug: string; jo: string; count: number }[];
  isolated: boolean;
};

const SECTION_LABEL: Record<string, string> = {
  규정집: "규정집",
  가이드: "연구행정 가이드",
  용어집: "용어집",
  시스템: "사내 시스템",
};

type Backlink = { slug: string; title: string; section: SectionKey };
type DrawerDoc = Doc & {
  backlinks: Backlink[];
  trackA?: TrackA | null;
  trackC?: TrackC | null;
  deadlines?: Deadline[] | null;
};

/**
 * Notion형 문서 드로어 — 목록/그래프/근거카드를 클릭하면 페이지 이동 없이
 * 오른쪽에서 슬라이드인되어 본문을 스크롤로 읽는다.
 * 본문은 out/docdata/<slug>.json 을 지연 로드(빌드타임 산출).
 */
export default function DocDrawer({
  slug,
  anchor: initialAnchor = "",
  highlight = false,
  highlightText = "",
  onClose,
}: {
  slug: string | null;
  anchor?: string;
  /** true면 인용 조문/별표 블록을 형광 강조 (cite_highlight 플래그) */
  highlight?: boolean;
  /** 앵커(조=='') 없는 출처(가이드·머리말 등)는 이 인용 텍스트로 본문에서 매칭해 강조 */
  highlightText?: string;
  onClose: () => void;
}) {
  const integrityOn = useFlag("article_integrity"); // Track A: 조문 참조·정의 패널
  const impactOn = useFlag("graph_impact"); // Track C: 개정 파급·함께 보는 조문 패널
  const deadlineOn = useFlag("deadline_calc"); // Track B: 기한 역산 계산기 패널
  const approvalOn = useFlag("approval_finder"); // Track B: 결재선 판정기(위임전결)
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

  // 본문 로드 후: 앵커(제N조/별표)면 그 블록, 앵커 없으면(조='') 인용 텍스트 매칭으로 블록 강조.
  useEffect(() => {
    if (!doc) return;
    const box = scrollRef.current;
    if (!box) return;
    box.querySelectorAll("." + styles.cited).forEach((e) => e.classList.remove(styles.cited)); // 이전 강조 제거

    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    // 시작 블록부터 다음 조/별표(id 블록) 직전까지, 또는 인용 길이만큼 묶어서 강조
    const markFrom = (start: Element, approxLen = 0) => {
      let cur: Element | null = start;
      let covered = 0;
      while (cur) {
        cur.classList.add(styles.cited);
        covered += norm(cur.textContent || "").length;
        const sib: Element | null = cur.nextElementSibling;
        if (!sib || (sib as HTMLElement).id || (approxLen && covered >= approxLen * 0.85)) break;
        cur = sib;
      }
    };

    const id = anchor ? decodeURIComponent(anchor.replace(/^#/, "")) : "";
    const el = id ? box.querySelector(`[id="${CSS.escape(id)}"]`) : null;
    if (el) {
      // 1) 앵커(제N조/별표/별지) — 정확. 그 블록 강조
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
      if (highlight) markFrom(el);
      return;
    }
    // 2) 앵커 없음(가이드·머리말 등 조=''): 인용 텍스트로 본문 블록 매칭
    if (highlight && highlightText) {
      const n = norm(highlightText);
      const cands = [n.slice(0, 60), n.slice(45, 105), n.slice(90, 150)].filter((c) => c.length >= 24);
      if (cands.length) {
        const blocks = Array.from(box.querySelectorAll("p, li, td, h2, h3, h4, blockquote"));
        const hit = blocks.find((bl) => {
          const bt = norm(bl.textContent || "");
          return cands.some((c) => bt.includes(c));
        });
        if (hit) {
          hit.scrollIntoView({ behavior: "smooth", block: "center" });
          markFrom(hit, n.length);
          return;
        }
      }
    }
    box.scrollTop = 0;
  }, [doc, anchor, highlight, highlightText]);

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

              {integrityOn && doc.trackA ? (
                <aside className={styles.trackA}>
                  {doc.trackA.crossRefs.length > 0 ? (
                    <section className={styles.taSec}>
                      <h2 className={styles.blTitle}>준용·참조하는 다른 규정 조문 · {doc.trackA.crossRefs.length}</h2>
                      <div className={styles.taChips}>
                        {doc.trackA.crossRefs.map((r, i) => (
                          <button
                            key={i}
                            className={styles.taChip}
                            title={`${doc.title} ${r.from} → ${r.toName} ${r.toJo} (${r.rel})`}
                            disabled={!r.toSlug}
                            onClick={() => r.toSlug && goInternal(r.toSlug, r.toJo ? `#${r.toJo}` : "")}
                          >
                            <span className={styles.taFrom}>{r.from}</span> →{" "}
                            <b>{r.toName}</b> {r.toJo}
                            {r.rel === "준용" ? <span className={styles.taRel}>준용</span> : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {doc.trackA.deleted.length > 0 || doc.trackA.added.length > 0 ? (
                    <section className={styles.taSec}>
                      <h2 className={styles.blTitle}>조문 효력 이력</h2>
                      <div className={styles.taChips}>
                        {doc.trackA.deleted.map((d, i) => (
                          <span key={`d${i}`} className={styles.taDeleted} title={`삭제됨${d.삭제일 ? " · " + d.삭제일 : ""}`}>
                            ⚠ {d.조} 삭제{d.삭제일 ? ` (${d.삭제일})` : ""}
                          </span>
                        ))}
                        {doc.trackA.added.map((a, i) => (
                          <span key={`a${i}`} className={styles.taAdded} title={`신설${a.신설일 ? " · " + a.신설일 : ""}`}>
                            {a.조} 신설{a.신설일 ? ` (${a.신설일})` : ""}
                          </span>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {doc.trackA.defs.length > 0 ? (
                    <section className={styles.taSec}>
                      <h2 className={styles.blTitle}>이 규정이 정의한 용어 · {doc.trackA.defs.length}</h2>
                      <ul className={styles.taDefs}>
                        {doc.trackA.defs.map((d, i) => (
                          <li key={i}>
                            <b>{d.term}</b>
                            <span className={styles.taDefJo}>{d.조}</span>
                            <span className={styles.taDefTxt}>{d.정의}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </aside>
              ) : null}

              {approvalOn && doc.title === "위임전결규정" ? (
                <aside className={styles.trackA}>
                  <h2 className={styles.blTitle}>결재선 판정기</h2>
                  <p className={styles.taHint}>
                    이 규정의 별표(전결권한)를 업무·직급으로 조회할 수 있어요 — 상단 메뉴 <b>결재선</b>에서.
                  </p>
                  <a className={styles.taChip} href="/approval/">🖋 결재선 판정기 열기 →</a>
                </aside>
              ) : null}

              {deadlineOn && doc.deadlines && doc.deadlines.length > 0 ? (
                <aside className={styles.trackA}>
                  <h2 className={styles.blTitle}>이 규정의 기한 · {doc.deadlines.length}</h2>
                  <p className={styles.taHint}>
                    기준일을 넣으면 마감일이 자동 계산돼요. 오프셋(며칠 이내)은 규정 원문 그대로, 계산은 순수 산술입니다 — 정확한 판단은 원문 확인 권장.
                  </p>
                  <DeadlineList deadlines={doc.deadlines} regName={doc.title} regNo={doc.regNo} />
                </aside>
              ) : null}

              {impactOn && doc.trackC ? (
                <aside className={styles.trackA}>
                  {doc.trackC.impactedBy.length > 0 ? (
                    <section className={styles.taSec}>
                      <h2 className={styles.blTitle}>
                        개정 파급 — 이 규정을 준용·참조하는 규정 · {doc.trackC.impactedBy.length}
                      </h2>
                      <p className={styles.taHint}>이 규정을 개정하면 아래 규정의 근거가 흔들릴 수 있어요(전이 참조 포함).</p>
                      <div className={styles.taChips}>
                        {doc.trackC.impactedBy.map((r, i) => (
                          <button
                            key={i}
                            className={styles.taChip}
                            title={`${r.name} (${r.hop}홉)`}
                            disabled={!r.slug}
                            onClick={() => r.slug && goInternal(r.slug, "")}
                          >
                            <b>{r.name}</b>
                            {r.hop > 1 ? <span className={styles.taRel}>{r.hop}홉</span> : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {doc.trackC.coCited.length > 0 ? (
                    <section className={styles.taSec}>
                      <h2 className={styles.blTitle}>함께 보는 조문 · {doc.trackC.coCited.length}</h2>
                      <p className={styles.taHint}>이 규정 조문과 같은 맥락에서 자주 함께 인용되는 다른 규정 조문.</p>
                      <div className={styles.taChips}>
                        {doc.trackC.coCited.map((r, i) => (
                          <button
                            key={i}
                            className={styles.taChip}
                            title={`${r.name} ${r.jo} · 공동인용 ${r.count}`}
                            disabled={!r.slug}
                            onClick={() => r.slug && goInternal(r.slug, r.jo ? `#${r.jo}` : "")}
                          >
                            <b>{r.name}</b> {r.jo}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {doc.trackC.isolated ? (
                    <p className={styles.taHint}>
                      🔌 이 규정은 다른 규정과의 조문 참조(준용·인용) 연결이 없습니다 — 교차링크 보강 후보.
                    </p>
                  ) : null}
                </aside>
              ) : null}

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
