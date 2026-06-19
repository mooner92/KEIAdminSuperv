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

const ROOT = path.join(__dirname, "out");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "3100", 10);

// RAG API(비서)는 127.0.0.1 전용. 브라우저는 같은 오리진 /api/rag/* 로만 호출하고
// 이 서버가 로컬 RAG API로 프록시한다 → CORS 불필요 + API가 LAN에 직접 노출되지 않음.
const RAG_HOST = process.env.RAG_HOST || "127.0.0.1";
const RAG_PORT = parseInt(process.env.RAG_PORT || "9000", 10);
// 정확 매핑(무상태 OpenAI 호환 RAG)
const API_ROUTES = {
  "/api/rag/chat": "/v1/chat/completions",
  "/api/rag/health": "/health",
};
// 비서 앱(상태형): /api/app/* → /app/*  (로그인/채팅기록, 쿠키 전달)
const APP_PREFIX = "/api/app/";

function proxyToRag(req, res, upstreamPath) {
  const opts = {
    host: RAG_HOST,
    port: RAG_PORT,
    path: upstreamPath,
    method: req.method,
    headers: { ...req.headers, host: `${RAG_HOST}:${RAG_PORT}` },
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
    send(res, status, data, { "Content-Type": type });
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
  let pathname;
  try {
    // 쿼리/해시 제거 + 한글 슬러그 디코드
    pathname = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  } catch {
    return send(res, 400, "Bad Request", { "Content-Type": "text/plain" });
  }

  // RAG/비서 API 리버스 프록시 (정적 라우팅보다 먼저 가로챈다)
  if (pathname.startsWith("/api/")) {
    if (API_ROUTES[pathname]) return proxyToRag(req, res, API_ROUTES[pathname]);
    // 비서 앱: /api/app/* → /app/* (쿼리스트링·원본 인코딩 보존)
    if (pathname.startsWith(APP_PREFIX)) {
      return proxyToRag(req, res, req.url.replace(/^\/api\/app/, "/app"));
    }
    return notFound(res);
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

  // 디렉터리(슬래시로 끝남) → index.html
  if (pathname.endsWith("/")) target = path.join(target, "index.html");

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    serveFile(res, target);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`KEI 행정 가이드 static server → http://${HOST}:${PORT}  (root: ${ROOT})`);
});
