import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import DocDrawer from "./DocDrawer";
import { api, type ChatMeta, type Message, type Source, type User } from "../lib/api";
import type { DocMeta } from "../lib/vault";
import styles from "./ChatApp.module.css";

const EXAMPLES = [
  "출장 여비는 어떻게 정산하나요?",
  "법인카드로 주말에 비품을 사도 되나요?",
  "연차휴가는 어떻게 신청하나요?",
  "초과근무 수당 지급 기준이 궁금해요.",
];
const STREAM_ID = -3; // 스트리밍 중인 assistant 메시지의 임시 id

/** 비서 본체 — 좌측 대화 목록 + 중앙 채팅(멀티턴) + 우측 메시지별 근거 + 문서 드로어. */
export default function ChatApp({
  user,
  docs,
  onLogout,
}: {
  user: User;
  docs: DocMeta[];
  onLogout: () => void;
}) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMsgId, setActiveMsgId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [openAnchor, setOpenAnchor] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const titleToSlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) if (!m.has(d.title)) m.set(d.title, d.slug);
    return m;
  }, [docs]);

  // 활성 메시지(없으면 마지막 assistant)의 근거를 우측에 표시
  const activeSources: Source[] = useMemo(() => {
    const m =
      messages.find((x) => x.id === activeMsgId) ||
      [...messages].reverse().find((x) => x.role === "assistant");
    return m?.sources ?? [];
  }, [messages, activeMsgId]);

  useEffect(() => {
    api.listChats().then((list) => {
      setChats(list);
      if (list.length) selectChat(list[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 스트리밍 중엔 토큰마다 갱신되므로 즉시 스크롤(애니메이션 X)으로 따라간다
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const selectChat = async (id: number) => {
    setActiveId(id);
    setMessages([]);
    setActiveMsgId(null);
    const { messages: msgs } = await api.getChat(id);
    setMessages(msgs);
    const lastAi = [...msgs].reverse().find((m) => m.role === "assistant");
    setActiveMsgId(lastAi?.id ?? null);
  };

  const newChat = async () => {
    const c = await api.createChat();
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setMessages([]);
    setActiveMsgId(null);
  };

  const removeChat = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("이 대화를 삭제할까요?")) return;
    await api.deleteChat(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      const next = chats.find((c) => c.id !== id);
      if (next) selectChat(next.id);
      else {
        setActiveId(null);
        setMessages([]);
        setActiveMsgId(null);
      }
    }
  };

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    let cid = activeId;
    if (!cid) {
      const c = await api.createChat();
      setChats((prev) => [c, ...prev]);
      cid = c.id;
      setActiveId(cid);
    }
    const chatId = cid as number;
    setInput("");
    setSending(true);
    // 낙관적: 사용자 메시지 + 비어있는 스트리밍 assistant 자리 추가
    setMessages((prev) => [
      ...prev,
      { id: -1, role: "user", content: q, sources: [], created_at: 0 },
      { id: STREAM_ID, role: "assistant", content: "", sources: [], created_at: 0 },
    ]);
    setActiveMsgId(STREAM_ID);
    try {
      await api.sendMessageStream(chatId, q, {
        onMeta: (sources, user) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === -1 ? user : m.id === STREAM_ID ? { ...m, sources } : m))
          ),
        onDelta: (t) =>
          setMessages((prev) => prev.map((m) => (m.id === STREAM_ID ? { ...m, content: m.content + t } : m))),
        onDone: (assistant, session) => {
          setMessages((prev) => prev.map((m) => (m.id === STREAM_ID ? assistant : m)));
          setActiveMsgId(assistant.id);
          if (session) setChats((prev) => [session, ...prev.filter((c) => c.id !== chatId)]);
        },
        onError: (msg) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === STREAM_ID ? { ...m, content: m.content || `⚠️ ${msg}` } : m))
          ),
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === STREAM_ID ? { ...m, content: m.content || "⚠️ 답변을 가져오지 못했습니다." } : m))
      );
    } finally {
      setSending(false);
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
      send();
    }
  };

  const empty = messages.length === 0 && !sending;

  return (
    <div className={styles.app}>
      {/* ── 좌측: 대화 목록 ── */}
      <aside className={styles.sidebar}>
        <button className={styles.newBtn} onClick={newChat}>
          ＋ 새 대화
        </button>
        <div className={styles.chatList}>
          {chats.map((c) => (
            <button
              key={c.id}
              className={`${styles.chatItem} ${c.id === activeId ? styles.chatItemActive : ""}`}
              onClick={() => selectChat(c.id)}
            >
              <span className={styles.chatTitle}>{c.title}</span>
              <span className={styles.del} onClick={(e) => removeChat(c.id, e)} title="삭제">
                ✕
              </span>
            </button>
          ))}
          {chats.length === 0 ? <div className={styles.noChats}>아직 대화가 없어요.</div> : null}
        </div>
        <div className={styles.userBar}>
          <span className={styles.userName}>👤 {user.username}</span>
          <button className={styles.logout} onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── 중앙: 채팅 ── */}
      <div className={styles.main}>
        <div className={styles.thread} ref={threadRef}>
          {empty ? (
            <div className={styles.welcome}>
              <div className={styles.wIcon}>💬</div>
              <h2 className={styles.wTitle}>무엇이 궁금하세요?</h2>
              <p className={styles.wLead}>
                사내 규정을 근거로 답해 드려요. 답변마다 <b>출처 조문</b>이 함께 저장됩니다.
              </p>
              <div className={styles.examples}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className={styles.exChip} onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className={styles.msgs}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <li key={m.id} className={styles.userRow}>
                    <div className={styles.userBubble}>{m.content}</div>
                  </li>
                ) : (
                  <li key={m.id} className={styles.aiRow}>
                    <span className={styles.aiTag}>비서</span>
                    <div
                      className={`${styles.aiBubble} ${m.id === activeMsgId ? styles.aiActive : ""} ${
                        m.sources.length ? styles.aiClickable : ""
                      }`}
                      onClick={() => m.sources.length && setActiveMsgId(m.id)}
                      title={m.sources.length ? "이 답변의 근거 조문 보기" : ""}
                    >
                      {m.content ? (
                        <Markdown source={m.content} />
                      ) : (
                        <span className={styles.typing}>근거 조문을 찾아 답변을 작성 중…</span>
                      )}
                      {m.sources.length ? (
                        <div className={styles.aiSrcHint}>
                          📎 근거 {m.sources.length}개 {m.id === activeMsgId ? "· 우측 표시 중" : "· 클릭해서 보기"}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              )}
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
            disabled={sending}
          />
          <button className={styles.send} onClick={() => send()} disabled={sending || !input.trim()}>
            {sending ? "…" : "보내기"}
          </button>
        </div>
        <p className={styles.disclaim}>
          답변은 규정 원문을 근거로 자동 생성됩니다. 금액·기한 등 중요한 사항은 <b>원문과 담당 부서</b> 확인이 필요합니다.
        </p>
      </div>

      {/* ── 우측: 근거 조문(메시지별) ── */}
      <aside className={styles.sources}>
        <div className={styles.srcHead}>
          <span className={styles.srcTitle}>근거 조문</span>
          {activeSources.length > 0 ? <span className={styles.srcCount}>{activeSources.length}</span> : null}
        </div>
        {activeSources.length === 0 ? (
          <div className={styles.srcEmpty}>
            질문하면 답변의 근거가 된 규정 조문이 여기에 표시돼요. 지난 답변을 클릭하면 그때의 근거를 다시 볼 수 있습니다.
          </div>
        ) : (
          <ul className={styles.srcList}>
            {activeSources.map((s, i) => {
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
