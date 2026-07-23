import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import Markdown from "./common/Markdown";
import DocDrawer from "./DocDrawer";
import ApprovalDrawer from "./ApprovalDrawer";
import { api, type ChatMeta, type Message, type Source, type Suggestion, type User } from "../lib/api";
import type { DocMeta } from "../lib/vault";
import type { JourneyChip } from "../lib/api";
import { ThinkingOrb } from "thinking-orbs"; // MIT(Jakub Antalik) — 사용자 지시로 외부 UI 0 원칙의 명시적 예외(CLAUDE.md)
import { useFlag } from "../lib/flags";
import { useBackClose } from "../lib/useBackClose";
import { CORPUS_AS_OF, SITE_NAME } from "../lib/site";
import { track } from "../lib/track";
import styles from "./ChatApp.module.css";

const EXAMPLES = [
  "출장 여비는 어떻게 정산하나요?",
  "법인카드로 주말에 비품을 사도 되나요?",
  "연차휴가는 어떻게 신청하나요?",
  "초과근무 수당 지급 기준이 궁금해요.",
];

// 상황 시작 칩(docs/38 §A, flag situation_chips) — 여정 id → 상황 문구·추천 질문.
// on이면 위 정적 EXAMPLES를 '대체'(빈 화면 칩 그룹 3개 난잡 방지 — 트렌딩 키워드와만 공존).
// 실존 여정(journeys prop)과 교집합만 노출. 질문은 입력 프리필 전용(자동 전송 없음 —
// trending·select_ask와 동일 원칙), 답은 항상 RAG 근거로 생성(질문 문구는 주제 프리셋일 뿐).
const SITUATIONS: { id: string; chip: string; qs: string[] }[] = [
  { id: "domestic-trip", chip: "🧳 첫 출장을 가요", qs: ["국내출장 여비는 어떻게 정산하나요?", "국내출장 신청은 어떤 절차로 하나요?"] },
  { id: "annual-leave", chip: "🌴 연차를 쓰고 싶어요", qs: ["연차휴가는 어떻게 신청하나요?", "연차는 최대 며칠까지 쓸 수 있나요?"] },
  { id: "법인카드사용정산", chip: "💳 법인카드를 처음 써요", qs: ["법인카드 사용 후 정산은 어떻게 하나요?", "법인카드로 주말에 결제해도 되나요?"] },
  { id: "overtime", chip: "⏰ 초과근무를 했어요", qs: ["초과근무 수당 지급 기준이 궁금해요.", "초과근무는 사전에 신청해야 하나요?"] },
  { id: "물품구매", chip: "🛒 물품을 사야 해요", qs: ["물품 구매는 어떤 절차로 진행하나요?", "물품 구매 시 견적서는 언제 필요한가요?"] },
  { id: "경조사", chip: "🕯️ 경조사가 생겼어요", qs: ["경조사 휴가는 며칠 쓸 수 있나요?", "경조금은 어떻게 신청하나요?"] },
  { id: "해외출장", chip: "✈️ 국외 출장을 가요", qs: ["국외출장 신청 절차가 궁금해요.", "국외출장 여비 기준이 궁금해요."] },
  { id: "유연근무신청", chip: "🕘 유연근무를 하고 싶어요", qs: ["유연근무는 어떻게 신청하나요?"] },
  { id: "육아시간사용", chip: "🍼 육아시간을 쓰고 싶어요", qs: ["육아시간은 어떻게 사용하나요?"] },
  { id: "휴직복직", chip: "🏥 휴직·복직이 필요해요", qs: ["휴직 신청 절차가 궁금해요."] },
  { id: "도서구입", chip: "📚 도서를 구입하고 싶어요", qs: ["업무용 도서 구입은 어떻게 하나요?"] },
  { id: "원외겸직", chip: "🎓 외부 강의·겸직을 해요", qs: ["외부 강의나 겸직은 어떻게 승인받나요?"] },
  { id: "괴롭힘성희롱신고", chip: "🛡️ 고충을 신고하고 싶어요", qs: ["직장 내 괴롭힘은 어디에 신고하나요?"] },
];
const SITU_PRIMARY = 6; // 기본 노출 칩 수 — 나머지는 '더 보기'로 접어 난잡 방지

// 부서 문의 핸드오프(docs/38 §A ★, flag handoff_card) — 거부 답변 감지.
// 백엔드 REFUSAL_RE(통계용)와 동일 계열이나 보수적: '규정에서 확인' 단독은
// 긍정문("규정에서 확인할 수 있습니다") 오탐 소지가 있어 제외.
const REFUSAL_UI_RE = /확인되지\s*않|확인할\s*수\s*없|찾을\s*수\s*없|근거가\s*없/;
const STREAM_ID = -3;

// 간단 타임스탬프: 오늘이면 "오후 2:31", 이전이면 "7/8" (요청: 간단하게만)
function fmtT(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return `${d.getMonth() + 1}/${d.getDate()}`;
} // 스트리밍 중인 assistant 메시지의 임시 id

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
  journeys,
  onLogout,
}: {
  user: User;
  docs: DocMeta[];
  journeys?: JourneyChip[];
  onLogout: () => void;
}) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMsgId, setActiveMsgId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<"search" | "write" | null>(null); // docs/34 ③: 2단계 대기 표시
  const abortRef = useRef<AbortController | null>(null); // docs/34 ③: Stop 버튼
  const tempIdRef = useRef(-1000); // 잔존 센티널 회수용 고유 음수 id 발급기
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [openAnchor, setOpenAnchor] = useState("");
  const [openSnippet, setOpenSnippet] = useState(""); // 앵커 없는 출처(조='') 텍스트 매칭 하이라이트용
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]); // docs/26: 답변 후속 제안(휘발성)
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
  const cardV2 = useFlag("source_card_v2");
  const followupOn = useFlag("followup_suggest"); // docs/26: 후속 질문 칩
  const selectAskOn = useFlag("select_ask"); // docs/26: 원문 선택 질문
  const trendingOn = useFlag("trending_keywords"); // docs/29 §1: 빈 화면 인기 키워드 칩
  const chatStopOn = useFlag("chat_stop"); // docs/34 ③: ■ 중단 버튼+2단계 대기 표시
  const orbOn = useFlag("thinking_orb"); // 사고 구슬 대기 표시(자체 canvas — thinking-orbs 컨셉 차용)
  const [trending, setTrending] = useState<{ k: string; n: number }[]>([]);
  useEffect(() => {
    if (!trendingOn) return;
    // k-익명 집계 — 용어집 등재어만(docs/49). 7일 창이 비면 30일로 폴백(칩 공백 방지). 실패 시 조용히 생략
    api.trending(7).then((r) => {
      if (r.keywords.length > 0) { setTrending(r.keywords); return; }
      return api.trending(30).then((r2) => setTrending(r2.keywords));
    }).catch(() => {});
  }, [trendingOn]);
  const situOn = useFlag("situation_chips"); // docs/38 §A: 빈 화면 상황 시작 칩(EXAMPLES 대체)
  const handoffOn = useFlag("handoff_card"); // docs/38 §A ★: 거부 답변 부서 문의 핸드오프 카드
  const anatomyOn = useFlag("answer_anatomy"); // docs/38 §B: 답변 해부 레이아웃(CSS 데코만·문구 불변)
  const [situSel, setSituSel] = useState<string | null>(null); // 선택된 상황(여정 id) — 미니 카드 토글
  const [situMore, setSituMore] = useState(false); // 7번째 이후 칩 펼침
  const situations = useMemo(() => {
    // 실존 여정과 교집합 — 여정 JSON이 빠지면 칩도 자동 소멸(깨진 딥링크 방지)
    const have = new Map((journeys || []).map((j) => [j.id, j]));
    return SITUATIONS.filter((s) => have.has(s.id)).map((s) => ({ ...s, j: have.get(s.id)! }));
  }, [journeys]);
  const actionsOn = useFlag("answer_actions"); // v1 ⑫(S6): 복사·인용 칩·수치 대조 // v1 ⑧·⑨(S3·S4): 배지 3단 위계·미검수 집계·거부 리프레임
  const [approvalOpen, setApprovalOpen] = useState(false); // 결재선 드로어(우측 슬라이드인)
  const [srcOverlay, setSrcOverlay] = useState(false); // v1 B6: ≤1080px 근거 바텀시트(넓은 화면에선 무시)
  // 바텀시트 스와이프-다운 닫기 — 1:1 추적 + **릴리스 속도로 판정**(apple-design §6: 릴리스
  // '지점'이 아니라 제스처가 '가는 방향'으로). 빠른 플릭은 짧아도 닫히고, 천천히 내려놓으면 유지.
  const [sheetDrag, setSheetDrag] = useState(0);
  const sheetRef = useRef<HTMLElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragHist = useRef<{ y: number; t: number }[]>([]); // 최근 이동 이력(속도 계산용)
  const onSheetTouchStart = (e: React.TouchEvent) => {
    // 시트가 맨 위로 스크롤된 상태에서만 드래그-닫기 시작(내부 스크롤과 충돌 방지)
    dragStartY.current = (sheetRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null;
    dragHist.current = [];
  };
  const onSheetTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const y = e.touches[0].clientY;
    const dy = y - dragStartY.current;
    dragHist.current = [...dragHist.current.slice(-4), { y, t: performance.now() }];
    if (dy > 0) { setSheetDrag(dy); if (e.cancelable) e.preventDefault(); } // 아래로만
  };
  const onSheetTouchEnd = () => {
    if (dragStartY.current !== null) {
      // 릴리스 속도(px/ms) — 최근 이력의 기울기. 이력 부족 시 0
      const h = dragHist.current;
      const v = h.length >= 2
        ? (h[h.length - 1].y - h[0].y) / Math.max(1, h[h.length - 1].t - h[0].t)
        : 0;
      // 아래로 빠른 플릭(>0.5px/ms)이면 거리 불문 닫기 · 위로 플릭이면 거리 커도 유지 · 그 외 거리 기준
      if (v > 0.5 || (sheetDrag > 90 && v >= -0.15)) setSrcOverlay(false);
    }
    dragStartY.current = null;
    setSheetDrag(0);
  };
  useEffect(() => { if (!srcOverlay) setSheetDrag(0); }, [srcOverlay]);
  useEffect(() => {
    if (!srcOverlay) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSrcOverlay(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [srcOverlay]);
  // 모바일 뒤로가기 제스처로 근거 시트·문서 드로어를 닫는다(페이지 이탈 대신) — docs/54
  useBackClose(srcOverlay, () => setSrcOverlay(false));
  useBackClose(openSlug !== null, () => setOpenSlug(null));

  // 활성 메시지(없으면 마지막 assistant)의 근거를 우측에 표시
  const activeSources: Source[] = useMemo(() => {
    const m =
      messages.find((x) => x.id === activeMsgId) ||
      [...messages].reverse().find((x) => x.role === "assistant");
    return m?.sources ?? [];
  }, [messages, activeMsgId]);

  // v1 ⑨(S4): 활성 답변이 '거부'인지 — 백엔드 REFUSAL_RE와 동일 계열 패턴. 거부면 근거를 '참고 검색 결과'로 리프레임.
  const activeIsRefusal = useMemo(() => {
    const m =
      messages.find((x) => x.id === activeMsgId && x.role === "assistant") ||
      [...messages].reverse().find((x) => x.role === "assistant");
    return !!m && /확인되지\s*않|확인할\s*수\s*없/.test(m.content || "");
  }, [messages, activeMsgId]);
  // v1 ⑧(S3-#39): 미검수는 카드마다 반복하지 않고 헤더에서 1회 집계(검수상태 값은 불변)
  const reviewedCnt = activeSources.filter((s) => titleToStatus.get(s.규정명) === "검수완료").length;

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
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setInput(q); // /?q=… 프리필(원문 선택 질문 등) — 자동 전송하지 않음
    } catch { /* ignore */ }
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
    setSuggestions([]);
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
    setPhase("search"); // docs/34 ③: 2단계 대기 표시 — 근거 수신 전 '검색 중'
    const ac = new AbortController();
    abortRef.current = ac;
    track("chat_send"); // 사용량(docs/35) — 질문 텍스트는 절대 안 보냄(이름만)
    setSuggestions([]);
    // 중단/오류로 남은 센티널 id(-1·STREAM_ID)를 고유 음수로 회수 — 새 스트림 핸들러의
    // m.id === STREAM_ID 매칭이 옛 말풍선을 오염시키는 것 방지(적대 검증 확정 결함).
    setMessages((prev) =>
      prev.map((m) =>
        m.id === STREAM_ID || m.id === -1 ? { ...m, id: tempIdRef.current-- } : m
      )
    );
    // 낙관적: 사용자 메시지 + 비어있는 스트리밍 assistant 자리 추가
    setMessages((prev) => [
      ...prev,
      { id: -1, role: "user", content: q, sources: [], created_at: 0 },
      { id: STREAM_ID, role: "assistant", content: "", sources: [], created_at: 0 },
    ]);
    setActiveMsgId(STREAM_ID);
    try {
      await api.sendMessageStream(chatId, q, {
        onMeta: (sources, user) => {
          setPhase("write"); // 근거 도착 — '답변 작성 중'으로 전환
          setMessages((prev) =>
            prev.map((m) => (m.id === -1 ? user : m.id === STREAM_ID ? { ...m, sources } : m))
          );
        },
        onDelta: (t) => {
          setPhase(null); // 첫 토큰 — 인디케이터 종료
          setMessages((prev) => prev.map((m) => (m.id === STREAM_ID ? { ...m, content: m.content + t } : m)));
        },
        onDone: (assistant, session, sugg) => {
          setMessages((prev) => prev.map((m) => (m.id === STREAM_ID ? assistant : m)));
          setActiveMsgId(assistant.id);
          if (session) setChats((prev) => [session, ...prev.filter((c) => c.id !== chatId)]);
          setSuggestions(sugg || []);
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
      }, ac.signal);
    } catch (e) {
      if (ac.signal.aborted) {
        // docs/34 ③ Stop: 클라이언트 수신만 중단 — 서버는 백그라운드 완료·저장.
        // 정직한 표기: 다시 열면 전체 답변이 보인다는 사실을 숨기지 않는다.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === STREAM_ID
              ? { ...m, content: `${m.content}\n\n⏹ (중단됨 — 지금까지 만들어진 답변은 저장돼요. 대화를 다시 열면 확인할 수 있어요)` }
              : m
          )
        );
      } else {
        const msg = e instanceof Error ? e.message : "연결이 끊겼습니다";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === STREAM_ID
              ? { ...m, content: m.content ? `${m.content}\n\n⚠️ (응답이 중간에 끊겼습니다 · ${msg})` : "⚠️ 답변을 가져오지 못했습니다. 다시 시도해 주세요." }
              : m
          )
        );
      }
    } finally {
      abortRef.current = null;
      setPhase(null);
      setSending(false);
    }
  };

  const stop = () => { track("chat_stop"); abortRef.current?.abort(); };

  // v1 B4: 절단/실패한 답변의 직전 질문을 다시 전송
  const retry = (mid: number) => {
    const idx = messages.findIndex((m) => m.id === mid);
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (prevUser?.content && !sending) send(prevUser.content);
  };
  // v1 ⑫(S6-#37): 답변 본문에 실제 인용된 [규정명 제N조] → 근거 카드 매칭(드로어 점프용)
  const CITE_RE = /\[([^\[\]\n]{2,40}?)\s+(제\d+조(?:의\d+)?)\]/g;
  const citedOf = (m: Message) => {
    if (!actionsOn || m.role !== "assistant" || !m.sources?.length) return [];
    const out: { label: string; src: Source }[] = [];
    const seen = new Set<string>();
    for (const mt of m.content.matchAll(CITE_RE)) {
      const [_, name, jo] = mt;
      const src = m.sources.find((s) => s.규정명 === name && (s.조 || "").startsWith(jo));
      const key = `${name}#${jo}`;
      if (src && !seen.has(key)) { seen.add(key); out.push({ label: `${name} ${jo}`, src }); }
    }
    return out.slice(0, 6);
  };

  // 클립보드 쓰기 공용(답변 복사·핸드오프 카드).
  // ⚠ navigator.clipboard는 보안 컨텍스트(HTTPS/localhost) 전용 — 사내 IP(HTTP) 접속에선 없음.
  // 그 경우 임시 textarea + execCommand('copy') 폴백으로 동작 보장.
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* 아래 폴백 시도 */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand("copy");
      ta.remove();
      return done;
    } catch { return false; }
  };

  // v1 ⑫(S6-#21): 복사 — 본문 + 출처 목록 + 기준일 자동 부착(면책은 본문에 이미 포함)
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyAnswer = async (m: Message) => {
    const srcList = (m.sources || []).map((s) => `- ${s.tag}`).join("\n");
    const text = `${m.content}\n\n[근거 출처]\n${srcList}\n(${SITE_NAME} · 규정집 기준일 ${CORPUS_AS_OF})`;
    if (await copyText(text)) {
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 1600);
    } else {
      alert("복사에 실패했습니다. 텍스트를 직접 선택해 복사해 주세요.");
    }
  };

  // 부서 문의 핸드오프(docs/38 §A ★) — 내 질문+함께 검색된 규정+기준일을 복사용 텍스트로 조립.
  // ⛔ 무엇도 생성하지 않음: 질문·근거 메타는 저장된 그대로, "근거를 찾지 못함"은 거부 사실 그대로.
  const [handoffCopied, setHandoffCopied] = useState<number | null>(null);
  const questionOf = (m: Message): string => {
    const i = messages.findIndex((x) => x.id === m.id);
    for (let k = i - 1; k >= 0; k--) if (messages[k].role === "user") return messages[k].content;
    return "";
  };
  const copyHandoff = async (m: Message) => {
    const q = questionOf(m);
    const seen = new Set<string>();
    const refs = (m.sources || [])
      .map((s) => `${s.규정명}${s.조 ? ` ${s.조}` : ""}`)
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
      .slice(0, 6);
    const text = [
      `[${SITE_NAME} 문의 준비]`,
      q ? `■ 질문: ${q}` : null,
      "■ 챗봇 확인 결과: 사내 규정에서 명확한 근거를 찾지 못했습니다.",
      refs.length ? `■ 함께 검색된 규정(참고): ${refs.join(" · ")}` : null,
      `■ 규정집 기준일: ${CORPUS_AS_OF}`,
      "※ 위 내용을 참고하여 문의드립니다.",
    ].filter(Boolean).join("\n");
    if (await copyText(text)) {
      setHandoffCopied(m.id);
      setTimeout(() => setHandoffCopied(null), 2000);
      track("handoff_copy", "/");
    } else {
      alert("복사에 실패했습니다. 텍스트를 직접 선택해 복사해 주세요.");
    }
  };

  // v1 ⑫(S6-#42): 수치 결정적 대조 — 답변의 금액·비율 토큰이 근거 스니펫 문구에 있는지(집계, fail-safe 주의 신호)
  const numAudit = (m: Message) => {
    if (!actionsOn || !m.sources?.length) return null;
    const nums = Array.from(m.content.matchAll(/\d[\d,]*\s*(?:원|만원|천원|억원|%|퍼센트)/g)).map((x) => x[0]);
    if (!nums.length) return null;
    const normN = (t: string) => t.replace(/[\s,]/g, "");
    const hay = normN((m.sources || []).map((s) => s.snippet || "").join(" "));
    const uniq = Array.from(new Set(nums.map(normN)));
    const found = uniq.filter((n) => hay.includes(n)).length;
    return { total: uniq.length, found };
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
  // 모바일(≤720px): 대화 목록을 위에 쌓지 않고 드로어로(docs/48 — 채팅이 첫 화면)
  const [sideOpen, setSideOpen] = useState(false);

  return (
    <div className={styles.app}>
      {/* ── 좌측: 대화 목록(모바일에선 드로어) ── */}
      {sideOpen ? <div className={styles.sideBackdrop} onClick={() => setSideOpen(false)} aria-hidden /> : null}
      <aside className={`${styles.sidebar} ${sideOpen ? styles.sidebarOpen : ""}`}>
        <button className={styles.newBtn} onClick={() => { newChat(); setSideOpen(false); }}>
          ＋ 새 대화
        </button>
        <div className={styles.chatList}>
          {chats.map((c) => (
            <button
              key={c.id}
              className={`${styles.chatItem} ${c.id === activeId ? styles.chatItemActive : ""}`}
              onClick={() => { selectChat(c.id); setSideOpen(false); }}
            >
              <span className={styles.chatTitle}>{c.title}</span>
              <span className={styles.chatTime}>{fmtT(c.updated_at)}</span>
              <span className={styles.del} onClick={(e) => removeChat(c.id, e)} title="삭제">
                ✕
              </span>
            </button>
          ))}
          {chats.length === 0 ? <div className={styles.noChats}>아직 대화가 없어요.</div> : null}
        </div>
        <div className={styles.userBar}>
          <span className={styles.userName}>🧑 {user.username}</span>
          <button className={styles.logout} onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── 중앙: 채팅 ── */}
      <div className={styles.main}>
        {/* 모바일 전용 바 — 대화 목록·새 대화(≤720px에서만 표시) */}
        <div className={styles.mobileBar}>
          <button onClick={() => setSideOpen(true)} aria-label="대화 목록 열기">☰ 대화 목록</button>
          <button onClick={newChat}>＋ 새 대화</button>
        </div>
        <div className={styles.thread} ref={threadRef}>
          {empty ? (
            <div className={styles.welcome}>
              <div className={styles.wIcon}>💬</div>
              <h2 className={styles.wTitle}>무엇이 궁금하세요?</h2>
              <p className={styles.wLead}>
                사내 규정을 근거로 답해 드려요. 답변마다 <b>출처 조문</b>이 함께 저장됩니다.
              </p>
              {situOn && situations.length > 0 ? (
                /* 상황 시작 칩(docs/38 §A) — 정적 예시 4개를 '대체'(칩 그룹 난립 방지). 트렌딩과만 공존 */
                <div className={styles.situWrap}>
                  <span className={styles.trendingLabel}>🧭 상황으로 시작해 보세요</span>
                  <div className={styles.examples}>
                    {(situMore ? situations : situations.slice(0, SITU_PRIMARY)).map((s) => (
                      <button key={s.id}
                        className={`${styles.exChip} ${situSel === s.id ? styles.situChipOn : ""}`}
                        aria-expanded={situSel === s.id}
                        onClick={() => { setSituSel(situSel === s.id ? null : s.id); track("situation_open", "/"); }}>
                        {s.chip}
                      </button>
                    ))}
                    {situations.length > SITU_PRIMARY ? (
                      <button className={`${styles.exChip} ${styles.situMoreBtn}`}
                        onClick={() => { setSituMore(!situMore); if (situMore) setSituSel(null); }}>
                        {situMore ? "접기 ▴" : `더 보기 +${situations.length - SITU_PRIMARY}`}
                      </button>
                    ) : null}
                  </div>
                  {situSel ? (() => {
                    const s = situations.find((x) => x.id === situSel);
                    return s ? (
                      <div className={styles.situCard}>
                        <div className={styles.situHead}>{s.j.emoji} <b>{s.j.title}</b></div>
                        {s.qs.map((q) => (
                          /* 클릭 = 입력 프리필(자동 전송 없음) — 사용자가 다듬은 뒤 전송 */
                          <button key={q} type="button" className={styles.situQ}
                            onClick={() => { setInput(q); track("situation_prefill", "/"); }}>
                            💬 {q}
                          </button>
                        ))}
                        <Link className={styles.situJourney} href={`/journey/?task=${encodeURIComponent(s.id)}`}
                          onClick={() => track("situation_journey", "/")}>
                          📋 업무 한 장으로 전체 흐름 보기 →
                        </Link>
                      </div>
                    ) : null;
                  })() : null}
                </div>
              ) : (
                <div className={styles.examples}>
                  {EXAMPLES.map((ex) => (
                    <button key={ex} className={styles.exChip} onClick={() => send(ex)}>
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              {trendingOn && trending.length > 0 ? (
                <div className={styles.trending}>
                  <span className={styles.trendingLabel}>📈 요즘 많이 찾는 키워드</span>
                  <div className={styles.examples}>
                    {trending.map((t) => (
                      /* 클릭 = 입력 프리필(자동 전송 없음 — select_ask와 동일 원칙). 키워드 텍스트는 안 보냄(이름만) */
                      <button key={t.k} className={styles.exChip}
                        onClick={() => { setInput(`${t.k} `); track("trending_click", "/"); }}>
                        {t.k}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <ul className={styles.msgs}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <li key={m.id} className={styles.userRow}>
                    {fmtT(m.created_at) ? <span className={styles.msgTime}>{fmtT(m.created_at)}</span> : null}
                    <div className={styles.userBubble}>{m.content}</div>
                  </li>
                ) : (
                  <li key={m.id} className={styles.aiRow}>
                    <span className={styles.aiTag}>
                      LLM{fmtT(m.created_at) ? <span className={styles.msgTime}> · {fmtT(m.created_at)}</span> : null}
                    </span>
                    <div
                      className={`${styles.aiBubble} ${m.id === activeMsgId ? styles.aiActive : ""} ${
                        m.sources.length ? styles.aiClickable : ""
                      }`}
                      onClick={() => m.sources.length && setActiveMsgId(m.id)}
                      title={m.sources.length ? "이 답변의 근거 조문 보기" : ""}
                    >
                      {m.content ? (
                        /* 답변 해부 레이아웃(docs/38 §B) — 래퍼 클래스만 추가, 텍스트는 그대로
                           Markdown에 전달(문구 불변). 콜아웃·스테퍼는 CSS 데코레이션. */
                        anatomyOn ? (
                          <div className={styles.answerAnatomy}>
                            <Markdown source={m.content} />
                          </div>
                        ) : (
                          <Markdown source={m.content} />
                        )
                      ) : (
                        /* docs/34 ③: 2단계 대기 표시 — 지금 무슨 일이 일어나는지 보여준다 */
                        <span className={styles.typing}>
                          {orbOn ? (
                            <ThinkingOrb size={20} aria-label="답변 준비 중"
                              state={chatStopOn && m.id === STREAM_ID && phase === "search" ? "searching" : "working"} />
                          ) : null}{" "}
                          {chatStopOn && m.id === STREAM_ID && phase === "search"
                            ? (orbOn ? "규정 검색 중…" : "🔍 규정 검색 중…")
                            : chatStopOn && m.id === STREAM_ID && phase === "write"
                              ? (orbOn ? "근거를 찾았어요 — 답변 작성 중…" : "✍️ 근거를 찾았어요 — 답변 작성 중…")
                              : "근거 조문을 찾아 답변을 작성 중…"}
                        </span>
                      )}
                      {m.sources.length ? (
                        <div className={styles.aiSrcHint}>
                          📚 근거 {m.sources.length}개 {m.id === activeMsgId ? "· 표시 중" : "· 클릭해서 보기"}
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
                    {/* v1 ⑫(S6-#42): 수치 대조 집계 — 결정적 문자열 매칭(검증 아님·주의 신호) */}
                    {(() => { const a = m.id > 0 ? numAudit(m) : null; return a ? (
                      <div className={styles.numAudit}>
                        🔢 수치 대조: 답변 속 {a.total}개 중 <b>{a.found}개</b>가 근거 문구와 일치
                        {a.found < a.total ? " — 나머지는 원문에서 직접 확인하세요(계산·요약된 수치일 수 있음)" : ""}
                      </div>
                    ) : null; })()}
                    {/* v1 ⑫(S6-#37): 답변에 실제 인용된 조문 → 드로어 점프 칩 */}
                    {m.id > 0 && citedOf(m).length > 0 ? (
                      <div className={styles.citedRow}>
                        {citedOf(m).map((c, ci) => (
                          <button key={ci} type="button" className={styles.citedChip}
                            title="답변이 인용한 조문 — 클릭하면 원문으로"
                            onClick={() => openSource(c.src)}>
                            🔗 {c.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {/* v1 B4: 절단/실패 답변엔 다시 시도 버튼(직전 질문 재전송) */}
                    {isTruncated(m) && !sending ? (
                      <button type="button" className={styles.retryBtn} onClick={() => retry(m.id)}>
                        🔄 다시 시도
                      </button>
                    ) : null}
                    {/* 부서 문의 핸드오프(docs/38 §A ★) — 거부 답변만. 컴팩트 보조 줄(선택 옵션임을
                        분명히 — 큰 박스는 '순차 단계'처럼 읽힘). 질문+참고 조문+기준일을 복사 한 번으로 준비 */}
                    {handoffOn && m.id > 0 && m.content && !isTruncated(m) && REFUSAL_UI_RE.test(m.content) ? (
                      <div className={styles.handoff}>
                        <span className={styles.handoffText}>🤝 규정 밖 내용이면 담당 부서에 문의해 보세요.</span>
                        <button type="button" className={styles.handoffBtn} onClick={() => copyHandoff(m)}
                          title="내 질문 + 함께 검색된 규정 + 규정집 기준일을 복사 — 메신저·메일에 붙여넣기">
                          {handoffCopied === m.id ? "✓ 복사됐어요" : "📋 문의 내용 복사"}
                        </button>
                      </div>
                    ) : null}
                    {/* 답변 평가(👍/👎) — 영속 메시지(id>0)에만. 스트리밍 중 임시 메시지는 제외 */}
                    {m.id > 0 ? (
                      <div className={styles.fbRow}>
                        {actionsOn ? (
                          <button type="button" className={styles.fbBtn} onClick={() => copyAnswer(m)}
                            title="답변을 출처 목록과 함께 복사">
                            {copiedId === m.id ? "✓ 복사됨" : "📋 복사"}
                          </button>
                        ) : null}
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

        {followupOn && suggestions.length > 0 && !sending ? (
          <div className={styles.suggestBar} aria-label="다음 질문 제안">
            {suggestions.map((s, i) =>
              s.type === "journey" ? (
                <a key={i} className={styles.suggestChip} href={`/journey/?task=${encodeURIComponent(s.journey || "")}`}>
                  {s.label}
                </a>
              ) : (
                <button key={i} className={styles.suggestChip} onClick={() => send(s.q)}>
                  {s.label}
                </button>
              )
            )}
          </div>
        ) : null}
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
          {/* 아이콘 전용(텍스트 제거) — 색·모양으로 구분, 입력창 공간 확보. 라벨은 aria로 유지 */}
          {sending && chatStopOn ? (
            <button className={styles.stop} onClick={stop} aria-label="응답 수신 중단" title="중단">
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
                <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" />
              </svg>
            </button>
          ) : sending ? (
            <button className={styles.send} disabled aria-label="답변 생성 중">…</button>
          ) : (
            <button className={styles.send} onClick={() => send()} disabled={!input.trim()} aria-label="보내기" title="보내기 (Enter)">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 19V6M6 12l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        <p className={styles.disclaim}>
          답변은 규정 원문을 근거로 자동 생성됩니다. 금액·기한 등 중요한 사항은 <b>원문과 담당 부서</b> 확인이 필요합니다.
        </p>
      </div>

      {/* ── 우측: 근거 조문(메시지별). ≤1080px에선 바텀시트로 표시(v1 B6) — 배경 탭/ESC 닫기 ── */}
      {srcOverlay ? <div className={styles.srcBackdrop} onClick={() => setSrcOverlay(false)} /> : null}
      <aside
        ref={sheetRef}
        className={`${styles.sources} ${srcOverlay ? styles.srcOverlayOpen : ""}`}
        style={sheetDrag > 0 ? { transform: `translateY(${sheetDrag}px)`, transition: "none" } : undefined}
        onTouchStart={srcOverlay ? onSheetTouchStart : undefined}
        onTouchMove={srcOverlay ? onSheetTouchMove : undefined}
        onTouchEnd={srcOverlay ? onSheetTouchEnd : undefined}
      >
        <div className={styles.srcHandle} aria-hidden="true" />
        <div className={styles.srcHead}>
          <span className={styles.srcTitle}>{cardV2 && activeIsRefusal ? "참고 검색 결과" : "근거 조문"}</span>
          {activeSources.length > 0 ? <span className={styles.srcCount}>{activeSources.length}</span> : null}
          <button className={styles.srcClose} onClick={() => setSrcOverlay(false)} aria-label="근거 닫기">✕</button>
        </div>
        {cardV2 && activeSources.length > 0 ? (
          <div className={styles.srcAggregate}>
            {activeIsRefusal
              ? "규정에서 확인되지 않아 답을 드리지 않았어요. 아래는 검색된 참고 자료일 뿐 답의 근거가 아닙니다."
              : reviewedCnt > 0
                ? `사람 검수 완료 ${reviewedCnt}/${activeSources.length}건 · 나머지는 자동 변환 원문`
                : "자동 변환 원문(사람 검수 전) 기준 — 금액·기한은 원문에서 확인하세요"}
          </div>
        ) : null}
        {cardV2 && activeIsRefusal && activeSources.length > 0 ? (
          <div className={styles.refusalTips}>
            💡 <b>이렇게 해보세요</b>: 업무 이름을 규정 용어로 바꿔 다시 묻기(예: 출장비→여비) ·
            상황을 더 구체적으로(누가·언제·무엇을) · 그래도 없으면 규정 밖 사안일 수 있어요 — 담당 부서에 문의하세요.
          </div>
        ) : null}
        {approvalHint ? (
          <button className={styles.approvalCta} onClick={() => setApprovalOpen(true)}>
            📝 결재 관련 내용이 언급됐어요 — <b>결재선을 알아볼까요?</b>
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
                      {highlightOn && i === 0 && !(cardV2 && activeIsRefusal) ? (
                        <span className={styles.keyBadge}>⭐ 핵심 근거</span>
                      ) : null}
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
                      {s.type === "uplaw" ? (
                        <span className={styles.uplawChip}
                          title={`상위 법령·연구회 공통 규범 — KEI 사내 규정이 아니에요(적용강도: ${s.적용강도 || "준거"}). 사내 세부 기준은 규정·담당 부서 확인`}>
                          ⚖ 상위 법령
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
                      ) : status && !cardV2 ? (
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
                      ) : integrityOn && !cardV2 && s.최근개정 ? (
                        <span className={styles.stRev} title="이 조문의 최근 개정 시점">
                          개정 {s.최근개정}
                        </span>
                      ) : null}
                      {integrityOn && !cardV2 && s.효력 !== "삭제" && s.신설 ? (
                        <span className={styles.stRev} title="최근 신설된 조문">
                          신설
                        </span>
                      ) : null}
                      {integrityOn && !cardV2 && s.표깨짐 ? (
                        <span
                          className={styles.stDeleted}
                          title="이 문서의 표가 변환 과정에서 손상되어 항목-값 짝이 어긋날 수 있어요. 금액·일수는 반드시 원문 표에서 확인하세요"
                        >
                          ⚠ 표 확인
                        </span>
                      ) : null}
                      {typeBadges && !cardV2 && s.value_store ? (
                        <span className={styles.autoChip} title="검수 완료된 표에서 결정적으로 조회한 값입니다(생성 아님)">
                          📊 수치 스토어
                        </span>
                      ) : null}
                      {typeBadges && !cardV2 && (s.graph_expand || s.graph_expand_reg || s.graph_expand_action || s.graph_expand_gian || s.scope_anchor) ? (
                        <span
                          className={styles.autoChip}
                          title={
                            s.graph_expand
                              ? "회수된 조문이 인용하는 별표(금액표 등)를 자동으로 함께 가져왔어요"
                              : s.graph_expand_reg
                                ? "회수된 조문이 준용·참조하는 다른 규정 조문을 자동으로 함께 가져왔어요"
                                : s.graph_expand_action
                                  ? "신청의 의무적 후속 단계(정산·결과보고) 화면을 자동으로 함께 가져왔어요"
                                  : s.scope_anchor
                                    ? "이 규정이 누구에게 적용되는지(목적·적용범위 조항)를 자동으로 함께 가져왔어요"
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
                    {cardV2 ? (
                      <span className={styles.srcMetaLine}>
                        {[
                          s.분류,
                          integrityOn && s.최근개정 && s.효력 !== "삭제" ? `개정 ${s.최근개정}` : "",
                          integrityOn && s.신설 && s.효력 !== "삭제" ? "신설" : "",
                          s.graph_expand ? "🔗 별표 자동첨부" : "",
                          s.graph_expand_reg ? "🔗 준용·참조 자동첨부" : "",
                          s.graph_expand_action ? "🔗 후속단계 자동첨부" : "",
                          s.graph_expand_gian ? "🔗 기안 자동첨부" : "",
                          s.scope_anchor ? "🔗 적용범위 자동첨부" : "",
                          s.value_store ? "📊 수치 스토어(검수 완료 표)" : "",
                          integrityOn && s.표깨짐 ? "⚠ 표 확인" : "",
                        ].filter(Boolean).join(" · ")}
                      </span>
                    ) : s.분류 ? (
                      <span className={styles.srcCat}>{s.분류}</span>
                    ) : null}
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
        onAskSelection={selectAskOn ? (text) => {
          setInput(`「${text}」 — 이게 무슨 뜻인가요?`);
          setOpenSlug(null); // 드로어 닫고 입력창으로(자동 전송 없음 — 사용자가 다듬은 뒤 전송)
        } : undefined}
      />
      {/* v1 B6: 좁은 화면 근거 접근 플로팅 버튼(CSS가 ≤1080px에서만 노출) */}
      {activeSources.length > 0 && !srcOverlay ? (
        <button className={styles.srcFab} onClick={() => setSrcOverlay(true)}>
          📚 근거 {activeSources.length}개
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
