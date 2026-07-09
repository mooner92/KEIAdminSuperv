import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import DocDrawer from "./DocDrawer";
import ApprovalDrawer from "./ApprovalDrawer";
import { api, type ChatMeta, type Message, type Source, type User } from "../lib/api";
import type { DocMeta } from "../lib/vault";
import { useFlag } from "../lib/flags";
import styles from "./ChatApp.module.css";

const EXAMPLES = [
  "출장 여비는 어떻게 정산하나요?",
  "법인카드로 주말에 비품을 사도 되나요?",
  "연차휴가는 어떻게 신청하나요?",
  "초과근무 수당 지급 기준이 궁금해요.",
];
const STREAM_ID = -3; // 스트리밍 중인 assistant 메시지의 임시 id

// 금액·한도 신뢰 강화: 답변에 금액/한도가 있으면 "원문에서 수치 확인" 안내 + 근거 스니펫의 수치 강조.
// ⛔ 생성 텍스트의 숫자는 검증 대상 — 사용자가 원문 표/조문을 직접 보도록 유도한다(절대 규칙 1).
const MONEY_RE = /(\d[\d,]*\s*(?:원|만원|천원|억원|퍼센트|%))|한도|상한|지급(?:액|률|기준)/;
const FIG_SRC =
  "(\\d[\\d,]*\\s*(?:원|만원|천원|억원|퍼센트|%|일|개월|년|시간|회|배|km|킬로미터|점|명))|한도|상한액|상한|지급액|기준액";
const hasMoney = (t: string): boolean => MONEY_RE.test(t || "");
function highlightFigures(text: string, cls: string): ReactNode {
  if (!text) return text;
  const re = new RegExp(FIG_SRC, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={i++} className={cls}>
        {m[0]}
      </mark>
    );
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++; // 0-length 매치 방지
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** LLM 본체 — 좌측 대화 목록 + 중앙 채팅(멀티턴) + 우측 메시지별 근거 + 문서 드로어. */
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
  const [openSnippet, setOpenSnippet] = useState(""); // 앵커 없는 출처(조='') 텍스트 매칭 하이라이트용
  const [reasonFor, setReasonFor] = useState<number | null>(null); // 👎 사유 입력창이 열린 메시지 id
  const [reasonText, setReasonText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const titleToSlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) if (!m.has(d.title)) m.set(d.title, d.slug);
    return m;
  }, [docs]);

  // 규정명 → 검수상태(근거 카드 배지용). docdata에서 조회 → 백엔드/재임베딩 불필요.
  const titleToStatus = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) if (!m.has(d.title)) m.set(d.title, d.reviewed || "");
    return m;
  }, [docs]);

  // #1 피드백: 근거 클릭 시 드로어에서 인용 조문 하이라이트 + 패널 '핵심 근거' 표시 (release 플래그)
  const highlightOn = true; // cite_highlight 졸업(v1 ⑦, 2026-07-09): 검증 완료 → 상시 적용
  const typeBadges = useFlag("source_type_badges"); // 📜규정(공식)/📘가이드(참고) 출처 성격 구분
  const integrityOn = useFlag("article_integrity"); // Track A: 조문 효력 배지(⚠삭제됨/개정일)
  const approvalOn = useFlag("approval_finder"); // Track B: 결재 언급 시 근거 패널에 결재선 판정기 제안
  const [approvalOpen, setApprovalOpen] = useState(false); // 결재선 드로어(우측 슬라이드인)
  const [srcOverlay, setSrcOverlay] = useState(false); // v1 B6: ≤1080px 근거 바텀시트(넓은 화면에선 무시)
  useEffect(() => {
    if (!srcOverlay) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSrcOverlay(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [srcOverlay]);

  // 활성 메시지(없으면 마지막 assistant)의 근거를 우측에 표시
  const activeSources: Source[] = useMemo(() => {
    const m =
      messages.find((x) => x.id === activeMsgId) ||
      [...messages].reverse().find((x) => x.role === "assistant");
    return m?.sources ?? [];
  }, [messages, activeMsgId]);

  // 결재 관련 감지: 활성 assistant 답변 + 직전 user 질문에 결재/기안/상신/전결 언급 시
  // "결재선 알아볼까요?" 제안. 질문의 업무 키워드(휴가·출장 등)를 판정기 검색어로 프리셋.
  const APPROVAL_KW = [
    "국내출장", "해외출장", "시내출장", "출장", "연차", "휴가", "병가", "휴직", "복직", "퇴직",
    "파견", "연구연수", "교육연수", "연수", "교육", "채용", "겸직", "자문", "강사", "초청",
    "출판", "구매", "계약", "예산", "여비", "법인카드", "물품", "행사",
  ];
  const approvalHint = useMemo(() => {
    if (!approvalOn || messages.length === 0) return null;
    const ai =
      messages.find((x) => x.id === activeMsgId && x.role === "assistant") ||
      [...messages].reverse().find((x) => x.role === "assistant");
    if (!ai) return null;
    const aiIdx = messages.indexOf(ai);
    const prevUser = [...messages.slice(0, aiIdx)].reverse().find((x) => x.role === "user");
    const text = `${prevUser?.content || ""}\n${ai.content || ""}`;
    if (!/결재|기안|상신|전결|품의/.test(text)) return null;
    const q = (prevUser?.content || "") + (ai.content || "");
    return { query: APPROVAL_KW.find((k) => q.includes(k)) || "" };
  }, [approvalOn, messages, activeMsgId]);

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
        // v1 B4: 부분 응답이 있어도 에러를 은폐하지 않는다 — 절단 안내를 덧붙임.
        // (서버 error 이벤트 뒤엔 마커가 부착된 저장본 done이 따라와 최종 상태를 확정)
        onError: (msg) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === STREAM_ID
                ? { ...m, content: m.content ? `${m.content}\n\n⚠️ (응답이 중간에 끊겼습니다 · ${msg})` : `⚠️ ${msg}` }
                : m
            )
          ),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "연결이 끊겼습니다";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === STREAM_ID
            ? { ...m, content: m.content ? `${m.content}\n\n⚠️ (응답이 중간에 끊겼습니다 · ${msg})` : "⚠️ 답변을 가져오지 못했습니다. 다시 시도해 주세요." }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  };

  // v1 B4: 절단/실패한 답변의 직전 질문을 다시 전송
  const retry = (mid: number) => {
    const idx = messages.findIndex((m) => m.id === mid);
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (prevUser?.content && !sending) send(prevUser.content);
  };
  const isTruncated = (m: Message) =>
    m.role === "assistant" && (m.content.includes("응답이 중간에 끊겼습니다") || m.content.includes("답변을 가져오지 못했습니다") || m.content.includes("생성 모델에 연결하지 못했습니다"));

  const openSource = (s: Source) => {
    const slug = titleToSlug.get(s.규정명) || s.slug;
    if (!slug) return;
    setOpenSlug(slug);
    setOpenAnchor(s.조 ? `#${s.조}` : "");
    setOpenSnippet(s.snippet || ""); // 앵커(조) 없으면 드로어가 이 텍스트로 본문 매칭해 강조
  };

  // 답변 평가(👍/👎). 같은 버튼을 다시 누르면 철회(toggle). 👎는 사유 입력창을 연다.
  const rate = async (mid: number, rating: "up" | "down") => {
    const cur = messages.find((m) => m.id === mid)?.feedback ?? null;
    try {
      if (cur === rating) {
        await api.clearFeedback(mid);
        setMessages((prev) =>
          prev.map((m) => (m.id === mid ? { ...m, feedback: null, feedback_reason: "" } : m))
        );
        if (reasonFor === mid) setReasonFor(null);
        return;
      }
      await api.sendFeedback(mid, rating);
      setMessages((prev) => prev.map((m) => (m.id === mid ? { ...m, feedback: rating } : m)));
      if (rating === "down") {
        setReasonText(messages.find((m) => m.id === mid)?.feedback_reason ?? "");
        setReasonFor(mid);
      } else if (reasonFor === mid) {
        setReasonFor(null);
      }
    } catch {
      /* 게이트/네트워크 오류: 서버 상태가 진실원천이므로 낙관적 변경을 남기지 않는다 */
      setMessages((prev) => [...prev]);
    }
  };

  const submitReason = async (mid: number) => {
    const t = reasonText.trim();
    try {
      await api.sendFeedback(mid, "down", t);
      setMessages((prev) =>
        prev.map((m) => (m.id === mid ? { ...m, feedback: "down", feedback_reason: t } : m))
      );
    } catch {
      /* 무시 */
    }
    setReasonFor(null);
    setReasonText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중 Enter는 무시(v1 스펙 B3) — 이중전송·마지막 글자 유실 방지.
    // keyCode 229 = 일부 브라우저의 IME 처리 중 키 이벤트.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
                    <span className={styles.aiTag}>LLM</span>
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
                          📎 근거 {m.sources.length}개 {m.id === activeMsgId ? "· 표시 중" : "· 클릭해서 보기"}
                        </div>
                      ) : null}
                    </div>
                    {/* 금액·한도 답변이면 원문 확인 유도(생성 숫자는 검증 대상). 클릭 시 근거 패널(좁은 화면=오버레이) */}
                    {m.content && hasMoney(m.content) ? (
                      <div
                        className={styles.moneyNote}
                        onClick={() => {
                          if (!m.sources.length) return;
                          setActiveMsgId(m.id);
                          setSrcOverlay(true); // ≤1080px 오버레이(넓은 화면에선 클래스 무효과)
                        }}
                      >
                        💰 금액·한도가 포함된 답변입니다. 정확한 수치는 <b>근거 원문</b>에서 확인하세요.
                      </div>
                    ) : null}
                    {/* v1 B4: 절단/실패 답변엔 다시 시도 버튼(직전 질문 재전송) */}
                    {isTruncated(m) && !sending ? (
                      <button type="button" className={styles.retryBtn} onClick={() => retry(m.id)}>
                        🔄 다시 시도
                      </button>
                    ) : null}
                    {/* 답변 평가(👍/👎) — 영속 메시지(id>0)에만. 스트리밍 중 임시 메시지는 제외 */}
                    {m.id > 0 ? (
                      <div className={styles.fbRow}>
                        <button
                          type="button"
                          className={`${styles.fbBtn} ${m.feedback === "up" ? styles.fbUp : ""}`}
                          onClick={() => rate(m.id, "up")}
                          aria-pressed={m.feedback === "up"}
                          title="도움이 됐어요"
                        >
                          👍
                        </button>
                        <button
                          type="button"
                          className={`${styles.fbBtn} ${m.feedback === "down" ? styles.fbDown : ""}`}
                          onClick={() => rate(m.id, "down")}
                          aria-pressed={m.feedback === "down"}
                          title="부정확하거나 부족해요"
                        >
                          👎
                        </button>
                        {m.feedback === "down" && m.feedback_reason && reasonFor !== m.id ? (
                          <span className={styles.fbReasonShown} title={m.feedback_reason}>
                            “{m.feedback_reason}”
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {reasonFor === m.id ? (
                      <div className={styles.fbReasonBox}>
                        <input
                          className={styles.fbReasonInput}
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME 가드(B3)
                            if (e.key === "Enter") submitReason(m.id);
                            if (e.key === "Escape") setReasonFor(null);
                          }}
                          placeholder="무엇이 부정확/부족했나요? (선택)"
                          maxLength={500}
                          autoFocus
                        />
                        <button type="button" className={styles.fbReasonSend} onClick={() => submitReason(m.id)}>
                          보내기
                        </button>
                        <button type="button" className={styles.fbReasonSkip} onClick={() => setReasonFor(null)}>
                          건너뛰기
                        </button>
                      </div>
                    ) : null}
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

      {/* ── 우측: 근거 조문(메시지별). ≤1080px에선 바텀시트로 표시(v1 B6) — 배경 탭/ESC 닫기 ── */}
      {srcOverlay ? <div className={styles.srcBackdrop} onClick={() => setSrcOverlay(false)} /> : null}
      <aside className={`${styles.sources} ${srcOverlay ? styles.srcOverlayOpen : ""}`}>
        <div className={styles.srcHandle} aria-hidden="true" />
        <div className={styles.srcHead}>
          <span className={styles.srcTitle}>근거 조문</span>
          {activeSources.length > 0 ? <span className={styles.srcCount}>{activeSources.length}</span> : null}
          <button className={styles.srcClose} onClick={() => setSrcOverlay(false)} aria-label="근거 닫기">✕</button>
        </div>
        {approvalHint ? (
          <button className={styles.approvalCta} onClick={() => setApprovalOpen(true)}>
            🖋 결재 관련 내용이 언급됐어요 — <b>결재선을 알아볼까요?</b>
            {approvalHint.query ? <span className={styles.approvalKw}>{approvalHint.query}</span> : null}
          </button>
        ) : null}
        {activeSources.length === 0 ? (
          <div className={styles.srcEmpty}>
            질문하면 답변의 근거가 된 규정 조문이 여기에 표시돼요. 지난 답변을 클릭하면 그때의 근거를 다시 볼 수 있습니다.
          </div>
        ) : (
          <ul className={styles.srcList}>
            {activeSources.map((s, i) => {
              const linkable = titleToSlug.has(s.규정명) || !!s.slug;
              const status = titleToStatus.get(s.규정명); // 검수완료 | 미검수 | undefined
              return (
                <li key={i}>
                  <button
                    className={`${styles.srcCard} ${linkable ? "" : styles.srcCardFlat}`}
                    onClick={() => openSource(s)}
                    disabled={!linkable}
                  >
                    <span className={styles.srcTag}>
                      {highlightOn && i === 0 ? <span className={styles.keyBadge}>⭐ 핵심 근거</span> : null}
                      <b>{s.규정명}</b> {s.조}
                      {typeBadges && s.type === "regulation" ? (
                        <span className={styles.regChip} title="공식 규정 원문 — KEI 규정집의 진실원천(원문 그대로)">
                          📜 규정
                        </span>
                      ) : null}
                      {typeBadges && s.type === "guide" ? (
                        <span className={styles.guideChip} title="참고 가이드 — 규정 원문을 쉽게 정리한 우리 문서(공식 규정 아님). 정확한 값은 원문 확인">
                          📘 가이드
                        </span>
                      ) : null}
                      {typeBadges && s.type === "term" ? (
                        <span className={styles.regChip} title="용어집 — 개념 설명">
                          📖 용어
                        </span>
                      ) : null}
                      {s.type === "system" ? (
                        <span className={styles.erpChip} title="이 시스템에서 처리 — 클릭하면 메뉴·기능 안내">
                          🖥 {(s.규정명 || "").split(" · ")[0].replace(/\s*시스템$/, "") || "시스템"}
                        </span>
                      ) : null}
                      {/별지|별표/.test(s.조) ? (
                        <span className={styles.formChip} title="서식/별표 — 클릭하면 양식 보기">
                          📄 서식
                        </span>
                      ) : null}
                      {status === "검수완료" ? (
                        <span className={styles.stOk} title="사람이 검수 완료한 원문">
                          ✓ 검수완료
                        </span>
                      ) : status ? (
                        <span className={styles.stWarn} title="아직 사람 검수 전입니다. 금액·기한은 원문 확인 필요">
                          미검수
                        </span>
                      ) : null}
                      {integrityOn && s.효력 === "삭제" ? (
                        <span
                          className={styles.stDeleted}
                          title={`이 조문은 삭제되어 효력이 없습니다${s.삭제일 ? " · " + s.삭제일 : ""}. 유효 근거로 사용하지 마세요`}
                        >
                          ⚠ 삭제됨{s.삭제일 ? ` (${s.삭제일})` : ""}
                        </span>
                      ) : integrityOn && s.최근개정 ? (
                        <span className={styles.stRev} title="이 조문의 최근 개정 시점">
                          개정 {s.최근개정}
                        </span>
                      ) : null}
                      {integrityOn && s.효력 !== "삭제" && s.신설 ? (
                        <span className={styles.stRev} title="최근 신설된 조문">
                          신설
                        </span>
                      ) : null}
                      {typeBadges && (s.graph_expand || s.graph_expand_reg || s.graph_expand_action || s.graph_expand_gian) ? (
                        <span
                          className={styles.autoChip}
                          title={
                            s.graph_expand
                              ? "회수된 조문이 인용하는 별표(금액표 등)를 자동으로 함께 가져왔어요"
                              : s.graph_expand_reg
                                ? "회수된 조문이 준용·참조하는 다른 규정 조문을 자동으로 함께 가져왔어요"
                                : s.graph_expand_action
                                  ? "신청의 의무적 후속 단계(정산·결과보고) 화면을 자동으로 함께 가져왔어요"
                                  : "결재상신(기안) 공통 흐름을 자동으로 함께 가져왔어요"
                          }
                        >
                          🔗 자동첨부
                        </span>
                      ) : null}
                      {s.절단 ? (
                        <span
                          className={styles.stWarn}
                          title="이 근거가 길어 뒷부분은 답변 생성에 반영되지 않았어요 — 정확한 값은 원문 확인"
                        >
                          일부 반영
                        </span>
                      ) : null}
                    </span>
                    {s.분류 ? <span className={styles.srcCat}>{s.분류}</span> : null}
                    <span className={styles.srcSnippet}>{highlightFigures(s.snippet, styles.fig)}</span>
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

      <DocDrawer
        slug={openSlug}
        anchor={openAnchor}
        highlight={highlightOn}
        highlightText={highlightOn ? openSnippet : ""}
        onClose={() => setOpenSlug(null)}
      />
      {/* v1 B6: 좁은 화면 근거 접근 플로팅 버튼(CSS가 ≤1080px에서만 노출) */}
      {activeSources.length > 0 && !srcOverlay ? (
        <button className={styles.srcFab} onClick={() => setSrcOverlay(true)}>
          📎 근거 {activeSources.length}개
        </button>
      ) : null}

      <ApprovalDrawer
        open={approvalOpen}
        initialQuery={approvalHint?.query || ""}
        onClose={() => setApprovalOpen(false)}
      />
    </div>
  );
}
