/**
 * KEI 행정 가이드 [뇌] — 정적 파일 서버 (의존성 0, Node 내장 모듈만)
 *
 * `next build`(output: "export") 산출물 `out/`을 그대로 서빙한다.
 * 운영 배포는 nginx@127.0.0.1 + Cloudflare Zero Trust가 정석이며,
 * 이 서버는 동일 산출물을 사내망에서 바로 미리보기/서빙하기 위한 PM2 관리용이다.
 *
 * 라우팅 규약은 next.config(trailingSlash: true)와 일치:
 *   /                → out/index.html
 *   /graph/          → out/graph/index.html
 *   /d/<slug>/       → out/d/<slug>/index.html
 *   /d/<slug>        → 308 redirect → /d/<slug>/   (정규 URL)
 *   /_next/...(확장자) → 해당 정적 파일
 *   없는 경로         → out/404.html (404)
 *
 * 환경변수: HOST(기본 0.0.0.0), PORT(기본 3100)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "out");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "3100", 10);

// ── 로그인 게이트(docs/44) — 랜딩(/,/about)이 외부 공개될 수 있어, 정적 산출물(규정 원문
// docdata/검색인덱스/문서 페이지)을 서버에서 차단한다. 클라이언트 게이트만으론 불충분.
// app_api.py와 같은 JWT(HS256, 쿠키 kei_session, tools/.app_secret)를 의존성 0으로 검증.
// REQUIRE_LOGIN=0 으로만 해제 가능(기본 켜짐 — fail-closed).
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN !== "0";
const SECRET_PATH = process.env.APP_SECRET_FILE || path.join(__dirname, "..", "tools", ".app_secret");
let SECRET = "";
try { SECRET = fs.readFileSync(SECRET_PATH, "utf8").trim(); } catch { /* 아래서 fail-closed */ }
if (REQUIRE_LOGIN && !SECRET) console.error(`⚠ 세션키(${SECRET_PATH}) 없음 — 로그인 검증 불가(전부 차단됨)`);

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
/** kei_session JWT(HS256) 검증 — 서명·만료 확인. 유효하면 true */
function isAuthed(req) {
  if (!REQUIRE_LOGIN) return true;
  if (!SECRET) return false;
  const m = /(?:^|;\s*)kei_session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 3) return false;
  try {
    const sig = crypto.createHmac("sha256", SECRET).update(`${parts[0]}.${parts[1]}`).digest();
    const given = b64url(parts[2]);
    if (sig.length !== given.length || !crypto.timingSafeEqual(sig, given)) return false;
    const payload = JSON.parse(b64url(parts[1]).toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

// 비로그인 허용 목록 — 랜딩 셸과 로그인에 필요한 최소만.
// ⛔ docdata/·search-index.json·changelog.json·approval.json·/d/·/browse/ 등
//    규정 콘텐츠는 절대 추가하지 말 것.
const PUBLIC_PAGE = /^\/(about\/?)?$/; // "/" 와 "/about(/)"
const PUBLIC_ASSET = [
  /^\/_next\/static\//, // 해시 JS/CSS(코드만, 콘텐츠 없음)
  /^\/_next\/data\/[^/]+\/(index|about)\.json$/, // 랜딩 페이지 데이터만
  /^\/fonts\//,
  /^\/favicon\.(svg|ico)$/,
];
const PUBLIC_API = [
  /^\/api\/app\/auth\//, // 로그인·가입·확인(me)
  /^\/api\/app\/flags$/, // 공개 플래그(비민감 불리언)
  /^\/api\/rag\/health$/,
];
function isPublicPath(pathname) {
  return (
    PUBLIC_PAGE.test(pathname) ||
    PUBLIC_ASSET.some((re) => re.test(pathname)) ||
    PUBLIC_API.some((re) => re.test(pathname))
  );
}

// RAG API(LLM)은 127.0.0.1 전용. 브라우저는 같은 오리진 /api/rag/* 로만 호출하고
// 이 서버가 로컬 RAG API로 프록시한다 → CORS 불필요 + API가 LAN에 직접 노출되지 않음.
const RAG_HOST = process.env.RAG_HOST || "127.0.0.1";
const RAG_PORT = parseInt(process.env.RAG_PORT || "9000", 10);
// 정확 매핑(무상태 OpenAI 호환 RAG)
const API_ROUTES = {
  "/api/rag/chat": "/v1/chat/completions",
  "/api/rag/health": "/health",
};
// LLM 앱(상태형): /api/app/* → /app/*  (로그인/채팅기록, 쿠키 전달)
const APP_PREFIX = "/api/app/";

// v1 ⑮(#51) + docs/44 §2: 기본 보안 헤더.
// CSP: Next 정적 export는 인라인 부트스트랩 스크립트가 필요해 'unsafe-inline'을 허용하되,
// 외부 오리진 로드(script/style/img/font/connect)는 전부 차단 — XSS 시 유출 경로를 막는다.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  // 서식 미리보기(2026-07-25): 우리 PDF를 우리 페이지 안 iframe으로 띄운다. 'self'로만 허용해
  // 외부 오리진 프레임 로드는 계속 차단(내부 문서를 남의 페이지에 심는 것도 frame-ancestors가 막음).
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
function secureHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // ⚠ DENY는 **같은 출처에서도** iframe을 막아 서식 미리보기가 깨졌다(2026-07-25 사용자 제보,
  // 실제 브라우저에서만 재현 — 헤드리스 검증이 놓친 결함). SAMEORIGIN이면 외부 사이트의
  // 클릭재킹은 여전히 차단하면서 우리 페이지 안 미리보기는 동작한다.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

// 프록시 요청 본문 상한(docs/44 §2) — 채팅/로그인 JSON은 수 KB면 충분. 초대형 본문 DoS 차단.
const MAX_BODY = parseInt(process.env.MAX_BODY_BYTES || String(2 * 1024 * 1024), 10); // 2MB

function proxyToRag(req, res, upstreamPath) {
  // 본문 상한 — Content-Length 선차단(스트리밍 초과는 아래 카운터가 차단)
  const declared = parseInt(req.headers["content-length"] || "0", 10);
  if (declared > MAX_BODY) {
    return send(res, 413, JSON.stringify({ error: "요청 본문이 너무 큽니다." }),
      { "Content-Type": "application/json; charset=utf-8" });
  }
  const opts = {
    host: RAG_HOST,
    port: RAG_PORT,
    path: upstreamPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${RAG_HOST}:${RAG_PORT}`,
      // 실제 소켓 IP로 '덮어씀'(브라우저가 보낸 XFF 위조 차단) — FastAPI 레이트리밋이 사용(docs/44)
      "x-forwarded-for": req.socket.remoteAddress || "?",
    },
  };
  const up = http.request(opts, (upRes) => {
    // hop-by-hop 헤더 제거 → Node가 프레이밍을 다시 잡게(SSE 스트리밍이 버퍼링/중복청크 없이 흐르도록)
    const headers = { ...upRes.headers };
    delete headers["transfer-encoding"];
    delete headers["content-length"];
    delete headers["connection"];
    res.writeHead(upRes.statusCode || 502, headers);
    upRes.pipe(res);
  });
  up.on("error", (e) => {
    send(
      res,
      502,
      JSON.stringify({ error: "RAG API에 연결하지 못했습니다.", detail: String(e.code || e.message) }),
      { "Content-Type": "application/json; charset=utf-8" }
    );
  });
  // 청크 전송(Content-Length 없음)도 상한 적용
  let received = 0;
  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_BODY) { up.destroy(); req.destroy(); }
  });
  req.pipe(up);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/vnd.hancom.hwpx",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(res, filePath, status = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 500, "Internal Server Error", { "Content-Type": "text/plain" });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    // 해시 붙은 _next 자산은 영구 캐시(immutable), 나머지(HTML·docdata)는 항상 재검증
    // → 배포 후 새로고침하면 항상 최신을 받음(stale HTML 방지).
    const immutable = filePath.includes(`${path.sep}_next${path.sep}`);
    const cache = immutable ? "public, max-age=31536000, immutable" : "no-cache";
    send(res, status, data, { "Content-Type": type, "Cache-Control": cache });
  });
}

function notFound(res) {
  const fp = path.join(ROOT, "404.html");
  fs.readFile(fp, (err, data) => {
    if (err) return send(res, 404, "Not Found", { "Content-Type": "text/plain" });
    send(res, 404, data, { "Content-Type": "text/html; charset=utf-8" });
  });
}

const server = http.createServer((req, res) => {
  secureHeaders(res);
  let pathname;
  try {
    // 쿼리/해시 제거 + 한글 슬러그 디코드
    pathname = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  } catch {
    return send(res, 400, "Bad Request", { "Content-Type": "text/plain" });
  }

  // robots.txt — 파일 없이 서버가 직접(공개 경로). 외부 공개돼도 색인 금지(내부 서비스).
  if (pathname === "/robots.txt") {
    return send(res, 200, "User-agent: *\nDisallow: /\n", { "Content-Type": "text/plain; charset=utf-8" });
  }

  const authed = isAuthed(req);

  // RAG/LLM API 리버스 프록시 (정적 라우팅보다 먼저 가로챈다)
  if (pathname.startsWith("/api/")) {
    if (API_ROUTES[pathname]) {
      // /api/rag/chat 업스트림(/v1)은 무인증(OpenAI 호환) — 게이트는 여기서(로그인 필수).
      if (!authed && !PUBLIC_API.some((re) => re.test(pathname))) {
        return send(res, 401, JSON.stringify({ error: "로그인이 필요합니다." }),
          { "Content-Type": "application/json; charset=utf-8" });
      }
      return proxyToRag(req, res, API_ROUTES[pathname]);
    }
    // LLM 앱: /api/app/* → /app/* (쿼리스트링·원본 인코딩 보존). 인증은 FastAPI가 자체 수행.
    if (pathname.startsWith(APP_PREFIX)) {
      return proxyToRag(req, res, req.url.replace(/^\/api\/app/, "/app"));
    }
    return notFound(res);
  }

  // 정적 산출물 게이트 — 비로그인은 랜딩 셸(허용 목록)만. 나머지는 랜딩으로.
  if (!authed && !isPublicPath(pathname)) {
    return send(res, 302, null, { Location: "/" });
  }

  // 경로 정규화 + 디렉터리 탈출(..) 차단
  const safe = path.normalize(pathname).replace(/^(\.\.([/\\]|$))+/, "");
  let target = path.join(ROOT, safe);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
  }

  const hasExt = path.extname(pathname) !== "";

  // 확장자 없는 경로는 디렉터리(라우트)로 취급 → trailingSlash 정규화
  if (!hasExt && !pathname.endsWith("/")) {
    return send(res, 308, null, { Location: pathname + "/" });
  }

  // 별지 원문 PDF(docs/50 §6) — 재색인 훅(01p)이 갱신하는 web/public/forms-pdf를 직접 서빙.
  // out/은 빌드 시점 사본이라, 웹 재빌드 없이도 최신 별지 PDF가 즉시 반영되게 public을 우선한다.
  // (게이트는 위에서 이미 통과 — /forms-pdf는 비공개 경로)
  if (safe.startsWith("forms-pdf" + path.sep) || safe.startsWith(path.join("/", "forms-pdf"))) {
    const live = path.join(__dirname, "public", safe.replace(/^[/\\]+/, ""));
    if (fs.existsSync(live) && fs.statSync(live).isFile()) {
      return serveFile(res, live);
    }
  }
  // 품질 게시판 데이터(docs/58) — 매일 daily_publish가 web/public/quality를 갱신 → 재빌드 없이 서빙.
  if (safe.startsWith("quality" + path.sep) || safe.startsWith(path.join("/", "quality"))) {
    const live = path.join(__dirname, "public", safe.replace(/^[/\\]+/, ""));
    if (fs.existsSync(live) && fs.statSync(live).isFile()) {
      return serveFile(res, live);
    }
  }

  // 디렉터리(슬래시로 끝남) → index.html
  if (pathname.endsWith("/")) target = path.join(target, "index.html");

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    serveFile(res, target);
  });
});

// 슬로우로리스 대비 명시적 타임아웃(docs/44 §2) — SSE 응답 시간에는 영향 없음(요청 수신 단계만)
server.headersTimeout = 30_000;
server.requestTimeout = 120_000;

server.listen(PORT, HOST, () => {
  console.log(`KEI 행정 가이드 static server → http://${HOST}:${PORT}  (root: ${ROOT})`);
});
