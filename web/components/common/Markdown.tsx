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

  return (
    <div className={styles.md}>
      {/* singleTilde:false — 시간 범위(12:00~18:00)의 ~가 취소선으로 오렌더되는 것 방지.
          취소선은 ~~옛값~~(docs/28 최신값 단일화)의 의미 표기로만 쓴다. */}
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}
