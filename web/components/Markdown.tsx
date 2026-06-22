import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import styles from "./Markdown.module.css";

// hast 노드에서 텍스트만 추출(제N조 감지용)
function nodeText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) return n.children.map(nodeText).join("");
  return "";
}

export default function Markdown({
  source,
  onNavigate,
}: {
  source: string;
  // 드로어 안에서 내부 문서 링크(/d/<slug>/#조)를 가로채 페이지 이동 없이 전환
  onNavigate?: (slug: string, anchor: string) => void;
}) {
  // 1) 01이 넣은 머리 H1(중복 제목) 제거
  // 2) 각 제N조가 별도 단락이 되도록 앞에 빈 줄 삽입 → 단락별 id 부여 가능
  const md = source
    .replace(/^\s*#[ \t]+[^\n]*\r?\n/, "")
    .replace(/\n[ \t]*(제\s*\d+\s*조)/g, "\n\n$1");

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
    p({ node, children }) {
      // 제N조 + 별표 N + 별지 제N호 단락에 id 부여 → 출처(s.조)로 앵커 스크롤·하이라이트
      const t = nodeText(node).trimStart();
      let id = "";
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^제\s*(\d+)\s*조/))) id = `제${m[1]}조`;
      else if ((m = t.match(/^\[?\s*별표\s*(\d+)/))) id = `별표 ${m[1]}`;
      else if ((m = t.match(/^\[?\s*별지\s*제?\s*(\d+)\s*호/))) id = `별지 제${m[1]}호`;
      if (id && !seen.has(id)) {
        seen.add(id);
        return (
          <p id={id} className={styles.article}>
            {children}
          </p>
        );
      }
      return <p>{children}</p>;
    },
  };

  return (
    <div className={styles.md}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}
