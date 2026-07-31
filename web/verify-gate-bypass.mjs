/**
 * 로그인 게이트 우회 · 경로 파싱 크래시 회귀 검증 (보안 스캔 F2/F5/F6/F15/F19/F20)
 *
 *   cd web && node verify-gate-bypass.mjs
 *
 * server.js를 **임시 디렉터리로 복사해** 띄우고, 그 안에 가짜 out/(공개 자산 + 비공개 문서)을
 * 만들어 실제 HTTP 요청을 쏜다. 실제 web/out/ 은 건드리지 않는다(빌드 산출물 오염 방지).
 *
 * 지키는 계약:
 *   ① 비로그인은 dot-segment(`..`)로 공개 허용목록을 우회해 비공개 문서를 받을 수 없다
 *      → 인가는 반드시 **정규화된 경로**로 판정해야 한다(정규화 → 인가 → 서빙 순서)
 *   ② 경로의 제어문자(NUL·CR·LF)로 프로세스를 죽이거나 헤더를 주입할 수 없다
 *   ③ 로그인 사용자의 정상 동작(문서 200, 한글 슬러그 308)은 그대로다
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import net from "node:net";
import crypto from "node:crypto";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3398", 10);
const SECRET_VALUE = "verify-gate-bypass-throwaway-key";

// ── 격리된 무대: server.js 사본 + 가짜 out/
const STAGE = mkdtempSync(path.join(tmpdir(), "kei-gate-"));
const SERVER = path.join(STAGE, "server.js");
copyFileSync(path.join(HERE, "server.js"), SERVER);

const OUT = path.join(STAGE, "out");
mkdirSync(path.join(OUT, "_next", "static"), { recursive: true });
mkdirSync(path.join(OUT, "d"), { recursive: true });
writeFileSync(path.join(OUT, "_next", "static", "app.js"), "// public asset\n");
writeFileSync(path.join(OUT, "d", "secret.html"), "SECRET-REGULATION-BODY\n");
writeFileSync(path.join(OUT, "index.html"), "landing\n");
writeFileSync(path.join(STAGE, ".app_secret"), SECRET_VALUE + "\n");

const srv = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    APP_SECRET_FILE: path.join(STAGE, ".app_secret"),
    REQUIRE_LOGIN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverErr = "";
srv.stderr.on("data", (d) => { serverErr += d; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(700);

/** raw 소켓 — 인코딩을 클라이언트가 손대지 않고 정확한 바이트를 보낸다 */
function get(rawPath, cookie) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
        (cookie ? `Cookie: ${cookie}\r\n` : "") +
        `Connection: close\r\n\r\n`
      );
    });
    let buf = "";
    sock.on("data", (d) => { buf += d; });
    sock.on("close", () => resolve(buf));
    sock.on("error", () => resolve(""));
    setTimeout(() => { sock.destroy(); resolve(buf); }, 3000);
  });
}
const status = (r) => (r.split("\r\n")[0] || "").trim();

/** 서버가 검증하는 것과 동일한 HS256 JWT를 만든다 */
function session() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: "verify", exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac("sha256", SECRET_VALUE).update(`${head}.${body}`).digest("base64url");
  return `kei_session=${head}.${body}.${sig}`;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "  ✅" : "  ❌"} ${name}${detail ? " — " + detail : ""}`);
}
/** 크래시 판정 — exitCode는 늦게 반영되므로 stderr도 함께 본다 */
async function alive() {
  await wait(250);
  return srv.exitCode === null && !/ERR_INVALID_CHAR|Uncaught|^\s*throw /m.test(serverErr);
}

console.log("\n[F2/F5/F6] 비로그인 + dot-segment 게이트 우회");
for (const p of [
  "/_next/static/../../d/secret.html",
  "/_next/static/..%2f..%2fd%2fsecret.html",
  "/fonts/../d/secret.html",
  "/_next/static/./../../d/secret.html",
  "/_next/data/x/index.json/../../../d/secret.html",
  // 실험실 에셋(specs/09 §3) — 직서빙 분기가 게이트 앞에 서지 않는지 + 분기 경유 탈출 불가
  "/lab-assets/../d/secret.html",
  "/_next/static/..%2f..%2flab-assets%2fcode-graph.html",
]) {
  const r = await get(p);
  const leaked = r.includes("SECRET-REGULATION-BODY");
  check(`차단: ${p}`, !leaked, leaked ? "🚨 비공개 문서 유출" : status(r));
}

console.log("\n[F19/F20] 경로 제어문자 — 프로세스 생존 · 헤더 인젝션 없음");
for (const [name, p] of [
  ["NUL", "/%00"],
  ["NUL 하위경로", "/d/secret.html%00.js"],
  ["CRLF", "/about%0d%0aX-Injected:%20yes"],
  ["CRLF 공개 프리픽스", "/fonts/%0d%0aSet-Cookie:%20evil=1"],
]) {
  const r = await get(p);
  const ok = await alive();
  check(`${name} — 서버 생존`, ok, ok ? status(r) : "🚨 프로세스 종료");
  check(`${name} — 헤더 인젝션 없음`, !/\r\nX-Injected:|\r\nSet-Cookie: evil/i.test(r));
}

console.log("\n[동작 보존] 공개 자산 · 랜딩 · 비로그인 차단");
check("공개 자산 200", (await get("/_next/static/app.js")).includes("public asset"));
check("랜딩 200", (await get("/")).includes("landing"));
check("비로그인은 비공개 문서 차단", !(await get("/d/secret.html")).includes("SECRET-REGULATION-BODY"));

console.log("\n[동작 보존] 로그인 사용자");
{
  const c = session();
  const doc = await get("/d/secret.html", c);
  check("로그인 시 문서 200", doc.includes("SECRET-REGULATION-BODY"), status(doc));

  const kr = await get("/d/%ea%b7%9c%ec%a0%95", c);
  const loc = ((/^Location:\s*(.+)$/im.exec(kr) || [])[1] || "").trim();
  check("한글 슬러그 308 정규화", status(kr).includes("308") && (await alive()), `→ ${loc}`);
  check("Location이 ASCII 인코딩", /^[\x20-\x7e]*$/.test(loc), loc);

  const esc = await get("/../../../../etc/passwd", c);
  check("로그인 사용자도 ROOT 탈출 차단", !esc.includes("root:"), status(esc));
}

srv.kill("SIGTERM");
await wait(200);

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌ 실패" : "✅ 전부 통과"} — ${results.length - failed.length}/${results.length}`);
if (failed.length && serverErr.trim()) console.log("서버 stderr:\n" + serverErr.trim().slice(0, 800));
process.exit(failed.length ? 1 : 0);
