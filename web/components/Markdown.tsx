import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import styles from "./Markdown.module.css";

// vault.ts에서 [[위키링크]]는 이미 [표시](/d/대상/#앵커) 마크다운 링크로 변환됨.
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
};

export default function Markdown({ source }: { source: string }) {
  // 01이 넣은 머리 H1(중복 제목)은 제거 — 제목은 페이지 헤더에서 따로 보여줌
  const md = source.replace(/^\s*#[ \t]+[^\n]*\r?\n/, "");
  return (
    <div className={styles.md}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}
