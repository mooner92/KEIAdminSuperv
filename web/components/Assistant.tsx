import { useMemo, useRef, useState, useEffect, type KeyboardEvent } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import DocDrawer from "./DocDrawer";
import type { DocMeta } from "../lib/vault";
import styles from "./Assistant.module.css";

type Msg = { role: "user" | "assistant"; content: string };
type Source = {
  규정명: string;
  조: string;
  분류: string;
  tag: string;
  snippet: string;
  distance: number;
  slug?: string;
};

const EXAMPLES = [
  "출장 여비는 어떻게 정산하나요?",
  "법인카드로 주말에 비품을 사도 되나요?",
  "연차휴가는 어떻게 신청하나요?",
  "초과근무 수당 지급 기준이 궁금해요.",
];

/**
 * 행정 비서(RAG 채팅) — 질문하면 규정 원문 근거로 답하고,
 * 오른쪽 패널에 근거 조문을 표시한다. 근거 카드를 누르면 Notion형 드로어로 원문을 펼친다.
 * 정적 사이트에서 클라이언트가 같은 오리진 /api/rag/chat 로 호출(→ 로컬 RAG API 프록시).
 */
export default function Assistant({ docs }: { docs: DocMeta[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [openAnchor, setOpenAnchor] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  // 규정명 → slug (근거 카드/문서 드로어 연결용)
  const titleToSlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) if (!m.has(d.title)) m.set(d.title, d.slug);
    return m;
  }, [docs]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setSources([]);
    setLoading(true);
    try {
      const r = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kei-admin-rag", messages: next }),
      });
      const d = await r.json();
      const answer = d?.choices?.[0]?.message?.content ?? "응답을 받지 못했습니다.";
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
      setSources(Array.isArray(d?.x_sources) ? d.x_sources : []);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ 비서에 연결하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const openSource = (s: Source) => {
    const slug = titleToSlug.get(s.규정명) || s.slug;
    if (!slug) return;
    setOpenSlug(slug);
    setOpenAnchor(s.조 ? `#${s.조}` : "");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.thread} ref={threadRef}>
          {empty ? (
            <div className={styles.welcome}>
              <div className={styles.wIcon}>💬</div>
              <h2 className={styles.wTitle}>무엇이 궁금하세요?</h2>
              <p className={styles.wLead}>
                사내 규정을 근거로 답해 드려요. 답변에는 <b>출처 조문</b>이 함께 표시됩니다.
              </p>
              <div className={styles.examples}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className={styles.exChip} onClick={() => ask(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className={styles.msgs}>
              {messages.map((m, i) => (
                <li key={i} className={m.role === "user" ? styles.userRow : styles.aiRow}>
                  {m.role === "assistant" ? <span className={styles.aiTag}>비서</span> : null}
                  <div className={m.role === "user" ? styles.userBubble : styles.aiBubble}>
                    {m.role === "assistant" ? <Markdown source={m.content} /> : m.content}
                  </div>
                </li>
              ))}
              {loading ? (
                <li className={styles.aiRow}>
                  <span className={styles.aiTag}>비서</span>
                  <div className={styles.aiBubble}>
                    <span className={styles.typing}>근거 조문을 찾아 답변을 작성 중…</span>
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </div>

        <div className={styles.composer}>
          <textarea
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="행정 업무에 대해 물어보세요. (Shift+Enter 줄바꿈)"
            rows={1}
            disabled={loading}
          />
          <button
            className={styles.send}
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
            aria-label="보내기"
          >
            {loading ? "…" : "보내기"}
          </button>
        </div>
        <p className={styles.disclaim}>
          답변은 규정 원문을 근거로 자동 생성됩니다. 금액·기한 등 중요한 사항은 <b>원문과 담당 부서</b> 확인이 필요합니다.
        </p>
      </div>

      <aside className={styles.sources}>
        <div className={styles.srcHead}>
          <span className={styles.srcTitle}>근거 조문</span>
          {sources.length > 0 ? <span className={styles.srcCount}>{sources.length}</span> : null}
        </div>
        {sources.length === 0 ? (
          <div className={styles.srcEmpty}>
            질문하면 답변의 근거가 된 규정 조문이 여기에 표시돼요. 카드를 누르면 원문을 펼쳐 볼 수 있습니다.
          </div>
        ) : (
          <ul className={styles.srcList}>
            {sources.map((s, i) => {
              const linkable = titleToSlug.has(s.규정명) || !!s.slug;
              return (
                <li key={i}>
                  <button
                    className={`${styles.srcCard} ${linkable ? "" : styles.srcCardFlat}`}
                    onClick={() => openSource(s)}
                    disabled={!linkable}
                  >
                    <span className={styles.srcTag}>
                      <b>{s.규정명}</b> {s.조}
                    </span>
                    {s.분류 ? <span className={styles.srcCat}>{s.분류}</span> : null}
                    <span className={styles.srcSnippet}>{s.snippet}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/graph/" className={styles.graphCta}>
          🕸️ 규정 관계 그래프 보기
        </Link>
      </aside>

      <DocDrawer slug={openSlug} anchor={openAnchor} onClose={() => setOpenSlug(null)} />
    </div>
  );
}
