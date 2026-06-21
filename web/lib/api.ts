// LLM 앱 API 클라이언트 — 같은 오리진 /api/app/*(server.js가 로컬 RAG API로 프록시).
// 쿠키(httpOnly 세션)는 같은 오리진이라 자동 전송된다.

export type User = { id: number; username: string; is_admin?: boolean };
export type FlagMeta = {
  key: string;
  enabled: boolean;
  description: string;
  owner: string;
  expires: string;
  updated_by: string;
  updated_at: number | null;
};
export type FlagAudit = { key: string; enabled: boolean; actor: string; at: number };
// 운영 대시보드 집계(관리자 전용)
export type Stats = {
  days: number;
  k_anon: number; // 인기질문·갭에 적용된 k-익명 임계(서로 다른 사용자 N명 이상만 노출)
  users: number;
  chats: number;
  questions: number;
  answers: number;
  refusals: number;
  refusal_rate: number;
  feedback: { up: number; down: number };
  top_questions: { q: string; n: number }[];
  gaps: { q: string; n: number }[];
};
export type ChatMeta = { id: number; title: string; created_at: number; updated_at: number };
export type Source = {
  규정명: string;
  조: string;
  분류: string;
  slug?: string;
  type?: string; // regulation|guide|system|term → ERP/서식 칩 표시
  tag: string;
  snippet: string;
  distance: number;
};
export type Feedback = "up" | "down" | null;
export type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  created_at: number;
  feedback?: Feedback; // 이 사용자의 답변 평가(👍/👎). 없으면 null
  feedback_reason?: string; // 👎 사유(선택)
};
// 관리자 피드백 신호(개인정보 보호: 질문·답변 본문 미포함 — 규정 메타 + 사유만)
export type FeedbackRow = {
  id: number;
  rating: "up" | "down";
  reason: string;
  at: number;
  sources: { 규정명: string; 조: string }[];
};

const BASE = "/api/app";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function j<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  // 타임아웃 → 게이트가 무한 '불러오는 중'으로 멈추지 않게(네트워크/엣지 지연 시 에러로 떨어져 로그인 노출)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(BASE + path, {
      credentials: "same-origin",
      signal: ctrl.signal,
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    let msg = `요청 실패 (${r.status})`;
    try {
      const e = await r.json();
      if (e?.detail) msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(r.status, msg);
  }
  return (r.status === 204 ? null : await r.json()) as T;
}

export type StreamHandlers = {
  onMeta?: (sources: Source[], user: Message) => void;
  onDelta?: (token: string) => void;
  onDone?: (assistant: Message, session: ChatMeta | null) => void;
  onError?: (message: string) => void;
};

// 스트리밍(SSE) 전송 — fetch + ReadableStream으로 토큰을 순차 수신.
// 서버 이벤트(한 줄 JSON): {type:"meta"|"delta"|"done"|"error", ...}
async function sendMessageStream(id: number, content: string, h: StreamHandlers): Promise<void> {
  const r = await fetch(`${BASE}/chats/${id}/messages?stream=1`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok || !r.body) {
    let msg = `요청 실패 (${r.status})`;
    try {
      const e = await r.json();
      if (e?.detail) msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
    } catch {
      /* ignore */
    }
    h.onError?.(msg);
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    // 이벤트 구분자 "\n\n"
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (obj.type === "meta") h.onMeta?.(obj.sources || [], obj.user);
      else if (obj.type === "delta") h.onDelta?.(obj.t || "");
      else if (obj.type === "done") h.onDone?.(obj.assistant, obj.session ?? null);
      else if (obj.type === "error") h.onError?.(obj.message || "오류가 발생했습니다.");
    }
  }
}

export const api = {
  me: () => j<User>("/auth/me", undefined, 7000), // 게이트: 7초 내 미응답이면 로그인 화면으로
  login: (username: string, password: string) =>
    j<User>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    j<User>("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => j<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  listChats: () => j<ChatMeta[]>("/chats"),
  createChat: () => j<ChatMeta>("/chats", { method: "POST" }),
  getChat: (id: number) => j<{ session: ChatMeta; messages: Message[] }>(`/chats/${id}`),
  sendMessage: (id: number, content: string) =>
    j<{ user: Message; assistant: Message; session: ChatMeta }>(`/chats/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  sendMessageStream,
  renameChat: (id: number, title: string) =>
    j<ChatMeta>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChat: (id: number) => j<{ ok: boolean }>(`/chats/${id}`, { method: "DELETE" }),

  // 답변 피드백(👍/👎). 같은 값을 다시 보내면 clear(철회)로 토글한다.
  sendFeedback: (mid: number, rating: "up" | "down", reason?: string) =>
    j<{ message_id: number; feedback: string; feedback_reason: string }>(
      `/messages/${mid}/feedback`,
      { method: "POST", body: JSON.stringify({ rating, reason: reason || "" }) }
    ),
  clearFeedback: (mid: number) =>
    j<{ message_id: number; feedback: null }>(`/messages/${mid}/feedback`, { method: "DELETE" }),
  feedbackList: (rating?: "up" | "down") =>
    j<FeedbackRow[]>(`/feedback${rating ? `?rating=${rating}` : ""}`), // 관리자 전용

  // 기능 플래그
  flags: () => j<Record<string, boolean>>("/flags", undefined, 6000), // 공개(UI 토글), 짧은 타임아웃
  flagsManage: () => j<{ flags: FlagMeta[]; admin: string }>("/flags/manage"),
  setFlag: (key: string, enabled: boolean) =>
    j<FlagMeta>(`/flags/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify({ enabled }) }),
  flagsAudit: () => j<FlagAudit[]>("/flags/audit"),
  stats: (days?: number) => j<Stats>(`/stats${days ? `?days=${days}` : ""}`), // 관리자 전용 대시보드
};
