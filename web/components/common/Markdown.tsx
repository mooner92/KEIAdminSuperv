import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import type { ReactNode } from "react";
import { useFlag } from "../../lib/flags";
import { annotateTerms, useTerms, type TermCtx } from "../../lib/terms";
import styles from "./Markdown.module.css";

// hast 노드에서 텍스트만 추출(제N조 감지용)
function nodeText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(nodeText).join("");
  return "";
}

// rehype-raw 없이 raw HTML이 문자로 노출되므로, 표 셀의 '<br>' 문자열을 실제 줄바꿈으로 변환.
// (볼트 표 규약: 셀 내 문단 경계 = <br> — hwp_tables·표 복원(docs/28 과업 B)이 생성)
function withBreaks(children: ReactNode): ReactNode {
  const out: ReactNode[] = [];
  let key = 0;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === "string" && /<br\s*\/?>/.test(child)) {
      const parts = child.split(/<br\s*\/?>/);
      parts.forEach((part, i) => {
        if (i > 0) out.push(<br key={`b${key++}`} />);
        if (part) out.push(part);
      });
    } else {
      out.push(child);
    }
  }
  return out;
}

// ── HTML 표 렌더(docs/61 K1ⓑ) — kordoc 변환 문서의 병합 셀 표(<table rowspan/colspan>)를 실표로 ──
// rehype-raw(외부 의존성) 대신 **표 태그 화이트리스트 재구성**: 허용 태그·속성만 다시 조립하고
// 그 외 태그는 전부 이스케이프(XSS 차단). 볼트는 내부 신뢰 소스지만 방어적으로 처리한다.
const TBL_TAGS = new Set(["table", "thead", "tbody", "tr", "th", "td", "br", "caption", "colgroup", "col"]);
const TBL_RE = /<table>[\s\S]*?<\/table>/g;

function sanitizeTable(html: string): string {
  return html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (whole, close, tag, attrs) => {
    const t = String(tag).toLowerCase();
    if (!TBL_TAGS.has(t)) {
      return whole.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // 비허용 태그는 무해화(텍스트로)
    }
    if (close) return `</${t}>`;
    // 허용 속성만 재조립(rowspan/colspan 숫자만) — 이벤트 핸들러·style 등 전부 제거
    let kept = "";
    const rs = String(attrs).match(/rowspan\s*=\s*["']?(\d+)/i);
    const cs = String(attrs).match(/colspan\s*=\s*["']?(\d+)/i);
    if (rs) kept += ` rowspan="${rs[1]}"`;
    if (cs) kept += ` colspan="${cs[1]}"`;
    return `<${t}${kept}>`;
  });
}

export default function Markdown({
  source,
  onNavigate,
  selfSlug,
}: {
  source: string;
  // 드로어 안에서 내부 문서 링크(/d/<slug>/#조)를 가로채 페이지 이동 없이 전환
  onNavigate?: (slug: string, anchor: string) => void;
  // 용어 툴팁: 자기 용어 노트에서 자기 자신 밑줄 금지(docs/45)
  selfSlug?: string;
}) {
  // 용어 인라인 툴팁(docs/45, flag term_tooltips) — 문서·드로어·채팅 답변 공통(같은 컴포넌트).
  // 사전 로드 전/실패/flag off엔 termCtx=null → 평문 그대로(안전 폴백).
  const termsOn = useFlag("term_tooltips");
  const termsData = useTerms(termsOn);
  // 렌더 패스당 새 Set — '문서당 용어별 첫 등장만 밑줄'(재렌더·스트리밍에도 결정적)
  const termCtx: TermCtx | null =
    termsOn && termsData ? { data: termsData, seen: new Set<string>(), selfSlug, onNavigate } : null;
  const terms = (ch: ReactNode) => (termCtx ? annotateTerms(ch, termCtx) : ch);
  // 1) 01이 넣은 머리 H1(중복 제목) 제거
  // 2) 각 제N조가 별도 단락이 되도록 앞에 빈 줄 삽입 → 단락별 id 부여 가능
  // 3) HTML 주석 제거 — <!--outdated …-->(docs/28) 등 메타데이터는 화면에 노출하지 않는다
  //    (rehype-raw 미사용이라 주석이 문자로 그대로 보이는 것 방지)
  const md = source
    .replace(/^\s*#[ \t]+[^\n]*\r?\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Obsidian 콜아웃 마커(> [!quote] 제목) — react-markdown이 몰라 raw 노출(01z 규정정의 노트 실측).
    // 마커는 떼고 제목은 굵게 살린다: "> [!quote] 규정 원문 — …" → "> **규정 원문 — …**"
    .replace(/^([ \t]*>[ \t]*)\[!\w+\][ \t]*([^\n]*)/gm, (_m, pre, t) => pre + (t.trim() ? `**${t.trim()}**` : ""))
    .replace(/\n[ \t]*(제\s*\d+\s*조)/g, "\n\n$1")
    // 별지 라벨도 별도 단락으로 분리 — 앞 문단에 흡수되면 id가 안 붙어 서식 앵커가 죽는다
    // (표 셀 라벨 '| [별지…' 은 표가 깨지므로 제외 — 파이프 시작 줄은 건드리지 않음)
    .replace(/\n[ \t]*([\[<【〔(]?\s*별지\s*제?\s*\d)/g, "\n\n$1");

  const seen = new Set<string>(); // 조 번호 중복 id 방지(제N조 / 제N조의M)

  const components: Components = {
    a({ href, children }) {
      const h = href ?? "";
      // 드로어 모드: 내부 문서 링크는 드로어 안에서 전환
      const internal = h.match(/^\/d\/([^/#]+)\/?(#.+)?$/);
      if (internal && onNavigate) {
        const slug = decodeURIComponent(internal[1]);
        const anchor = internal[2] || "";
        return (
          <a
            href={h}
            className={styles.link}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(slug, anchor);
            }}
          >
            {children}
          </a>
        );
      }
      if (h.startsWith("/")) {
        return (
          <Link href={h} className={styles.link}>
            {children}
          </Link>
        );
      }
      return (
        <a href={h} className={styles.link} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
    td({ children }) {
      return <td>{terms(withBreaks(children))}</td>;
    },
    th({ children }) {
      return <th>{withBreaks(children)}</th>;
    },
    li({ children }) {
      return <li>{terms(withBreaks(children))}</li>;
    },
    p({ node, children }) {
      // 제N조 + 별표 N + 별지 제N호 단락에 id 부여 → 출처(s.조)로 앵커 스크롤·하이라이트
      const t = nodeText(node).trimStart();
      let id = "";
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^제\s*(\d+)\s*조/))) id = `제${m[1]}조`;
      else if ((m = t.match(/^\[?\s*별표\s*(\d+)/))) id = `별표 ${m[1]}`;
      else if ((m = t.match(/^[\[<【〔(]?\s*별지\s*제?\s*(\d+(?:-\d+)?)\s*호(의\s*\d+)?/)))
        id = `별지 제${m[1]}호${(m[2] || "").replace(/\s+/g, "")}`; // ⚠ vault.ts FORM_LABEL과 동기 유지(서식 찾기 앵커 계약)
      if (id && !seen.has(id)) {
        seen.add(id);
        return (
          <p id={id} className={styles.article}>
            {terms(children)}
          </p>
        );
      }
      return <p>{terms(children)}</p>;
    },
  };

  // HTML 표(<table>…</table>, kordoc 병합 셀 보존)를 분리 — 표는 새니타이즈 후 실표로,
  // 나머지는 기존 ReactMarkdown 경로 그대로(표 없는 문서는 세그먼트 1개 = 기존과 동일).
  const segs: { kind: "md" | "table"; text: string }[] = [];
  let last = 0;
  for (const m of md.matchAll(TBL_RE)) {
    if (m.index! > last) segs.push({ kind: "md", text: md.slice(last, m.index!) });
    segs.push({ kind: "table", text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < md.length) segs.push({ kind: "md", text: md.slice(last) });

  return (
    <div className={styles.md}>
      {/* singleTilde:false — 시간 범위(12:00~18:00)의 ~가 취소선으로 오렌더되는 것 방지.
          취소선은 ~~옛값~~(docs/28 최신값 단일화)의 의미 표기로만 쓴다. */}
      {segs.map((sg, i) =>
        sg.kind === "table" ? (
          <div key={i} className={styles.htmlTable}
            dangerouslySetInnerHTML={{ __html: sanitizeTable(sg.text) }} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[[remarkGfm, { singleTilde: false }]]} components={components}>
            {sg.text}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}
