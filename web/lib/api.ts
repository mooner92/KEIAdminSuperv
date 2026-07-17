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
  효력?: string; // Track A: 조문 효력(삭제|유효). 삭제면 근거 카드에 '삭제됨' 경고 배지
  삭제일?: string; // 삭제 조문의 삭제 시점(표시용)
  최근개정?: string; // 이 조문의 최근 개정일(YYYY.M.D) — 개정 배지
  신설?: boolean; // 신설 조문 여부
  // 자동첨부 마커(top-5 검색이 아니라 그래프 확장으로 딸려온 근거) — 🔗 배지로 구분
  graph_expand?: boolean; // 별표(금액표) 자동첨부
  graph_expand_reg?: boolean; // 준용/참조 규정 자동첨부
  graph_expand_action?: boolean; // 행위 후속단계(정산·결과보고) 자동첨부
  graph_expand_gian?: boolean; // 결재상신(기안) 흐름 자동첨부
  절단?: boolean; // 근거가 길어 뒷부분이 LLM 컨텍스트에서 잘림 — '일부 반영' 배지
  표깨짐?: boolean; // P0-3(docs/22): HWP 변환에서 표 구조 손상 — '⚠ 표 확인' 배지(수치는 원문 확인)
  scope_anchor?: boolean; // P0-2(docs/22): 인용 규정의 목적·적용범위(제1~2조) 자동첨부 — 🔗 배지
  value_store?: boolean; // 지렛대③(docs/24): 검수 완료 표에서 결정적 조회한 값 — 📊 배지
};
export type Suggestion = { type: "ask" | "journey"; label: string; q?: string; journey?: string };
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
// 표 복원 검수(docs/24): 01p 복원 제안 — rows 셀 안 <br>은 UI에서 줄바꿈으로 렌더
export type RestoreTable = { label: string; verdict: string; rows: string[][] };
export type RestoreDoc = {
  name: string; source: string; 사유: string[]; 표본: string[];
  tables: RestoreTable[]; matchable: number; manual_needed: string[]; applied_at: number | null;
};
export type CorpusDoc = {
  slug: string; title: string; 구분: string; section: string; 검수상태: string;
  chunks: number; excluded: boolean; needs_reindex: boolean;
};
export type FeedbackRow = {
  id: number;
  rating: "up" | "down";
  reason: string;
  at: number;
  sources: { 규정명: string; 조: string }[];
};

// 의견 보내기(능동 제보, docs/51)
export type ReportRow = {
  id: number;
  유형: string;
  대상규정: string;
  대상조문: string;
  내용: string;
  상태: string;
  admin_note: string;
  제보자?: string; // 관리자 목록에만
  group?: string;
  at: number;
};

export type MaintNoticeRow = { id: number; kind: string; summary: string; at: number; unread: boolean };

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
  onDone?: (assistant: Message, session: ChatMeta | null, suggestions?: Suggestion[]) => void;
  onError?: (message: string) => void;
};

// 스트리밍(SSE) 전송 — fetch + ReadableStream으로 토큰을 순차 수신.
// 서버 이벤트(한 줄 JSON): {type:"meta"|"delta"|"done"|"error", ...}
// signal(docs/34 ③): Stop 버튼용 AbortSignal — 중단은 '클라이언트 수신 종료'다(서버는 백그라운드
// 완료·저장 → 대화를 다시 열면 전체 답변이 보인다는 사실을 UI가 정직하게 표기).
async function sendMessageStream(id: number, content: string, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const r = await fetch(`${BASE}/chats/${id}/messages?stream=1`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
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
      else if (obj.type === "done") h.onDone?.(obj.assistant, obj.session ?? null, obj.suggestions || []);
      // 서버 절단/실패 이벤트(v1 B4): err=예외명, partial=부분 응답 존재 여부. 이후 done(마커 포함 저장본)이 따라옴.
      else if (obj.type === "error") h.onError?.(obj.err || obj.message || "오류가 발생했습니다.");
    }
  }
}

// 가입 정책(docs/29 §3): register는 계정을 만들고 인증 코드를 보낸다(로그인 아님).
// dev_code는 APP_DEV_ECHO_CODE=1(개발·E2E)일 때만 존재.
export type RegisterPending = { pending?: true; pending_approval?: true; email: string; dev_code?: string };
export type DirectoryUser = {
  id: number; username: string; created_at: number;
  verified: boolean; is_admin: boolean; chats: number; last_active: number | null;
};

// 사용량 수집(docs/35 §0) — 🔒 집계만(개별 사용자 행위 미반환).
// users=null은 k-익명 마스킹(min_users명 미만) — UI는 'N명 미만'으로 표시.
export type Usage = {
  days: number;
  min_users: number;
  events: { name: string; n: number; users: number | null }[];
  pages: { page: string; n: number }[];
  dau: { day: string; users: number | null }[];
};

// 신뢰 운영 트랙(docs/34 ②) — 🔒 본문·메시지 id 없음(규정 메타·집계만)
export type TrustOps = {
  days: number;
  radar: { at: number; 근거: { 규정명: string; 조: string; 검수상태: string; slug?: string }[]; n_unreviewed: number }[];
  matrix: { 규정명: string; 인용수: number; slug: string; 검수상태: string; down: number }[];
  feedback_types: { 유형: string; n: number }[];
  feedback_reasons: { 유형: string; 사유: string; at: number }[];
};

export const api = {
  me: () => j<User>("/auth/me", undefined, 7000), // 게이트: 7초 내 미응답이면 로그인 화면으로
  login: (username: string, password: string) =>
    j<User>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    j<RegisterPending>("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  verifyEmail: (username: string, code: string) =>
    j<User>("/auth/verify", { method: "POST", body: JSON.stringify({ username, code }) }),
  resendCode: (username: string, password: string) =>
    j<RegisterPending>("/auth/resend", { method: "POST", body: JSON.stringify({ username, password }) }),
  listUsers: () => j<{ n: number; users: DirectoryUser[] }>("/users"),
  approveUser: (id: number) => j<{ id: number; verified: boolean }>(`/users/${id}/approve`, { method: "POST" }),
  rejectUser: (id: number) => j<{ deleted: number }>(`/users/${id}/reject`, { method: "POST" }),
  trending: (days = 7) =>
    j<{ days: number; min_users: number; keywords: { k: string; n: number }[] }>(`/trending?days=${days}`),
  trust: (days = 30) => j<TrustOps>(`/trust?days=${days}`),
  usage: (days = 30) => j<Usage>(`/usage?days=${days}`),
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

  // 의견 보내기(능동 제보, docs/51)
  createReport: (body: { 유형: string; 대상규정?: string; 대상조문?: string; 내용: string }) =>
    j<{ id: number; 상태: string }>("/reports", { method: "POST", body: JSON.stringify(body) }),
  myReports: () => j<ReportRow[]>("/reports"),
  allReports: (상태?: string) =>
    j<ReportRow[]>(`/reports/all${상태 ? `?상태=${encodeURIComponent(상태)}` : ""}`), // 관리자
  patchReport: (id: number, body: { 상태?: string; admin_note?: string }) =>
    j<{ id: number; 상태: string; admin_note: string }>(`/reports/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  maintNotices: () => j<{ unread: number; notices: MaintNoticeRow[] }>("/maint/notices"), // 관리자
  maintNoticesRead: () => j<{ ok: boolean }>("/maint/notices/read", { method: "POST" }),
  maintPlanLatest: () => j<{ name: string; md: string }>("/maint/plan/latest"), // 관리자(404=계획 없음)
  maintAnalyze: () => j<{ started: boolean }>("/maint/analyze", { method: "POST" }), // 관리자 '지금 분석'

  // 기능 플래그
  flags: () => j<Record<string, boolean>>("/flags", undefined, 6000), // 공개(UI 토글), 짧은 타임아웃
  flagsManage: () => j<{ flags: FlagMeta[]; admin: string }>("/flags/manage"),
  setFlag: (key: string, enabled: boolean) =>
    j<FlagMeta>(`/flags/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify({ enabled }) }),
  flagsAudit: () => j<FlagAudit[]>("/flags/audit"),

  // 코퍼스 관리 P1(관리자) — docs/20
  corpusList: () =>
    j<{ docs: CorpusDoc[]; summary: { total: number; excluded: number; indexed_chunks: number; needs_reindex: number } }>("/corpus"),
  corpusExclude: (slug: string, excluded: boolean) =>
    j<{ slug: string; excluded: boolean }>("/corpus/exclude", { method: "POST", body: JSON.stringify({ slug, excluded }) }),
  corpusReindex: () => j<{ started: boolean }>("/corpus/reindex", { method: "POST" }),
  corpusReindexStatus: () =>
    j<{ running: boolean; ok: boolean | null; log: string[]; backups: string[] }>("/corpus/reindex"),
  // P3 업로드(관리자) — multipart는 j() 대신 전용 fetch(Content-Type 자동)
  corpusUpload: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BASE}/corpus/upload`, { method: "POST", credentials: "same-origin", body: fd });
    if (!r.ok) {
      let msg = `업로드 실패 (${r.status})`;
      try { const e = await r.json(); if (e?.detail) msg = e.detail; } catch { /* ignore */ }
      throw new ApiError(r.status, msg);
    }
    return (await r.json()) as { id: string; name: string; warn: string; preview: string; chars: number };
  },
  corpusUploads: () => j<{ uploads: { id: string; name: string; warn: string; at: number }[] }>("/corpus/uploads"),
  corpusApprove: (id: string, doc_type: "guide" | "regulation", title: string) =>
    j<{ slug: string; path: string }>(`/corpus/uploads/${id}/approve`, { method: "POST", body: JSON.stringify({ doc_type, title }) }),
  corpusReject: (id: string) => j<{ rejected: string }>(`/corpus/uploads/${id}/reject`, { method: "POST" }),
  corpusRollback: (backup: string) =>
    j<{ rolled_back_to: string }>("/corpus/rollback", { method: "POST", body: JSON.stringify({ backup }) }),
  // 표 복원 검수(docs/24) — 반영은 사람의 명시적 클릭으로만
  tableRestoreList: () => j<{ docs: RestoreDoc[] }>("/corpus/table-restore"),
  tableRestoreApply: (name: string) =>
    j<{ matched: number; replaced: { file: string; 표: string; 행: number }[]; backups: string[]; manual_needed: string[] }>(
      "/corpus/table-restore/apply", { method: "POST", body: JSON.stringify({ name }) }),
  stats: (days?: number) => j<Stats>(`/stats${days ? `?days=${days}` : ""}`), // 관리자 전용 대시보드
};
