// 비서 앱 API 클라이언트 — 같은 오리진 /api/app/*(server.js가 로컬 RAG API로 프록시).
// 쿠키(httpOnly 세션)는 같은 오리진이라 자동 전송된다.

export type User = { id: number; username: string };
export type ChatMeta = { id: number; title: string; created_at: number; updated_at: number };
export type Source = {
  규정명: string;
  조: string;
  분류: string;
  slug?: string;
  tag: string;
  snippet: string;
  distance: number;
};
export type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  created_at: number;
};

const BASE = "/api/app";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
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

export const api = {
  me: () => j<User>("/auth/me"),
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
  renameChat: (id: number, title: string) =>
    j<ChatMeta>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChat: (id: number) => j<{ ok: boolean }>(`/chats/${id}`, { method: "DELETE" }),
};
