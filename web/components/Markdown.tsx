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

export default function Markdown({ source }: { source: string }) {
  // 1) 01이 넣은 머리 H1(중복 제목) 제거
  // 2) 각 제N조가 별도 단락이 되도록 앞에 빈 줄 삽입 → 단락별 id 부여 가능
  const md = source
    .replace(/^\s*#[ \t]+[^\n]*\r?\n/, "")
    .replace(/\n[ \t]*(제\s*\d+\s*조)/g, "\n\n$1");

  const seen = new Set<string>(); // 조 번호 중복 id 방지(제N조 / 제N조의M)

  const components: Components = {
    a({ href, children }) {
      const h = href ?? "";
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
      const m = nodeText(node).trimStart().match(/^제\s*(\d+)\s*조/);
      if (m) {
        const id = `제${m[1]}조`;
        if (!seen.has(id)) {
          seen.add(id);
          return (
            <p id={id} className={styles.article}>
              {children}
            </p>
          );
        }
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
