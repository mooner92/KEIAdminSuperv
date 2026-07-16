/**
 * 용어 인라인 툴팁(docs/45, flag term_tooltips) — 본문·답변 속 행정 용어(복명·전결·품의…)에
 * 점선 밑줄을 달고, 호버/포커스/탭 시 용어집 정의 팝오버를 띄운다. 0클릭·무LLM.
 *
 * 설계:
 * - 데이터 = 빌드타임 /terms-tooltip.json (emit-docdata가 30_용어집에서 추출, ~수십 KB) 런타임 1회 fetch.
 * - 주입은 React 렌더러 레벨(Markdown p/li/td의 문자열 children 치환) — DOM 직접 조작이 아니라
 *   스트리밍 재렌더와 충돌하지 않는다(채팅 답변도 같은 Markdown을 쓰므로 자동 커버).
 * - 매칭: 최장 우선 · 시작 경계만 요구(앞이 한글/영숫자면 단어 중간 → 제외, 뒤 조사는 허용)
 *   · 문서(렌더)당 용어별 첫 등장만 밑줄(시각 소음 방지).
 * - ⛔ 용어집은 자동 초안이 많다 — 미검수 용어는 팝오버에 '검수 전 초안' 배지(절대규칙 3).
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Terms.module.css";

export type TermEntry = { t: string; s: string; d: string; r: boolean };
export type TermsData = { re: RegExp; map: Map<string, TermEntry> };

let cache: TermsData | null = null;
let failed = false; // 404 등 — 재시도 폭주 방지
let pending: Promise<void> | null = null;
const subs = new Set<() => void>();

async function load(): Promise<void> {
  try {
    const r = await fetch("/terms-tooltip.json");
    if (!r.ok) { failed = true; return; }
    const list: TermEntry[] = await r.json();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alts = [...list].sort((a, b) => b.t.length - a.t.length).map((x) => esc(x.t));
    if (!alts.length) { failed = true; return; }
    cache = {
      re: new RegExp(`(?<![가-힣A-Za-z0-9])(${alts.join("|")})`, "g"),
      map: new Map(list.map((x) => [x.t, x])),
    };
  } catch {
    failed = true;
  } finally {
    subs.forEach((f) => f());
  }
}

/** 용어 사전 구독 — flag on일 때만 fetch. 로드 전/실패 시 null(=주석 없이 평문 렌더). */
export function useTerms(enabled: boolean): TermsData | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || cache || failed) return;
    const f = () => force((v) => v + 1);
    subs.add(f);
    if (!pending) pending = load();
    else if (cache || failed) f();
    return () => { subs.delete(f); };
  }, [enabled]);
  return enabled ? cache : null;
}

export type TermCtx = {
  data: TermsData;
  seen: Set<string>; // 렌더(문서)당 용어별 첫 등장만
  selfSlug?: string; // 용어 자기 노트에선 자기 자신 밑줄 금지
  onNavigate?: (slug: string, anchor: string) => void; // 드로어 내 전환
};

/** p/li/td의 children에서 문자열만 골라 용어를 <TermHit>로 치환 */
export function annotateTerms(children: ReactNode, ctx: TermCtx): ReactNode {
  const arr = Array.isArray(children) ? children : [children];
  let key = 0;
  const out = arr.map((child) => {
    if (typeof child !== "string" || !child) return child;
    ctx.data.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const parts: ReactNode[] = [];
    let last = 0;
    while ((m = ctx.data.re.exec(child))) {
      const term = m[1];
      const entry = ctx.data.map.get(term);
      if (!entry || entry.s === ctx.selfSlug || ctx.seen.has(term)) continue;
      ctx.seen.add(term);
      parts.push(child.slice(last, m.index));
      parts.push(<TermHit key={`t${key++}`} entry={entry} onNavigate={ctx.onNavigate} />);
      last = m.index + term.length;
    }
    if (!parts.length) return child;
    parts.push(child.slice(last));
    return parts;
  });
  return out;
}

function TermHit({
  entry,
  onNavigate,
}: {
  entry: TermEntry;
  onNavigate?: (slug: string, anchor: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const hideT = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);

  const show = () => {
    window.clearTimeout(hideT.current);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom > window.innerHeight - 190; // 아래 공간 부족 → 위로
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 296)), y: up ? r.top - 6 : r.bottom + 6, up });
  };
  const hide = () => { hideT.current = window.setTimeout(() => setPos(null), 180); };

  return (
    <span
      ref={ref}
      className={styles.hit}
      tabIndex={0}
      role="button"
      aria-label={`용어 설명: ${entry.t}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => { e.stopPropagation(); if (pos) setPos(null); else show(); }}
      onKeyDown={(e) => { if (e.key === "Escape") setPos(null); }}
    >
      {entry.t}
      {pos ? (
        <span
          className={styles.pop}
          role="tooltip"
          style={pos.up ? { left: pos.x, bottom: window.innerHeight - pos.y } : { left: pos.x, top: pos.y }}
          onMouseEnter={() => window.clearTimeout(hideT.current)}
          onMouseLeave={hide}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={styles.popHead}>
            <b>{entry.t}</b>
            {!entry.r ? <i className={styles.draft}>검수 전 초안</i> : null}
          </span>
          {entry.d ? <span className={styles.def}>{entry.d}</span> : null}
          <Link
            href={`/d/${encodeURIComponent(entry.s)}/`}
            className={styles.more}
            onClick={
              onNavigate
                ? (e) => { e.preventDefault(); setPos(null); onNavigate(entry.s, ""); }
                : undefined
            }
          >
            용어집에서 보기 →
          </Link>
        </span>
      ) : null}
    </span>
  );
}
