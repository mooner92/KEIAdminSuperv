// docs/29 §3·§4 실렌더 검증 — 가입 정책(@kei.re.kr·이메일 인증·ID=메일) + 관리자 사용자 탭.
// dev(3101/9001) + APP_DEV_ECHO_CODE=1 필요(코드가 화면 안내문에 표시됨).
// 실행: cd web && node verify-signup.mjs
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://localhost:3101";
const EMAIL = `e2e.signup.${Date.now() % 100000}@kei.re.kr`;
const b = await chromium.launch();
// 이 테스트는 이메일 코드 흐름 전용 — 승인제 플래그(docs/36 §10)가 dev에 켜져 있으면 register가
// 코드 대신 승인 대기를 반환한다. 백엔드 플래그를 off로 토글하고 끝나면 원상 복원(finally).
const admin = await b.newContext();
await admin.request.post(BASE + "/api/app/auth/login", { data: { username: "admintest", password: "admtest123" } });
let approvalWas = false;
try {
  const f = await (await admin.request.get(BASE + "/api/app/flags")).json();
  approvalWas = !!f.signup_approval;
  if (approvalWas) await admin.request.post(BASE + "/api/app/flags/signup_approval", { data: { enabled: false } });
} catch { /* 플래그 없거나 미인증 — 코드 흐름이 기본이면 그대로 진행 */ }
const restore = async () => {
  if (approvalWas) await admin.request.post(BASE + "/api/app/flags/signup_approval", { data: { enabled: true } }).catch(() => {});
  await admin.close().catch(() => {});
};
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log((ok ? "✅" : "❌") + " " + name + (detail ? " — " + detail : ""));
  ok ? pass++ : fail++;
};

await p.goto(BASE + "/", { waitUntil: "load" });
await p.waitForTimeout(1200);

// ① 회원가입 화면 진입 + 외부 도메인 거부
await p.getByText("회원가입", { exact: true }).click();
await p.waitForTimeout(300);
check("① 가입 폼: 이메일 라벨", await p.getByText("KEI 이메일 (아이디)").isVisible());
check("① 도메인 안내 문구", await p.getByText("KEI 임직원 이메일(@kei.re.kr)로만").isVisible());
await p.fill('input[autocomplete="username"]', "hacker@gmail.com");
await p.fill('input[type="password"]', "pw123456");
await p.getByRole("button", { name: "인증 코드 받기" }).click();
await p.waitForTimeout(800);
check("① 외부 도메인 거부 오류", (await p.innerText("body")).includes("KEI 이메일"));

// ② KEI 이메일 가입 → 코드 단계(개발 모드 코드 표시)
await p.fill('input[autocomplete="username"]', EMAIL);
await p.getByRole("button", { name: "인증 코드 받기" }).click();
await p.waitForTimeout(1000);
const body1 = await p.innerText("body");
check("② 코드 입력 단계 전환", body1.includes("이메일 인증") && body1.includes("6자리"));
const m = body1.match(/인증 코드[:\s]*([0-9]{6})/);
check("② dev 코드 표시", !!m, m ? m[1] : "코드 못 찾음");
await p.screenshot({ path: "verify-signup-code.png" });

// ③ 오답 코드 거부 → 정답 코드 로그인
const code = m ? m[1] : "000000";
const wrong = code === "111111" ? "222222" : "111111";
await p.fill('input[inputmode="numeric"]', wrong);
await p.getByRole("button", { name: "인증하고 시작" }).click();
await p.waitForTimeout(800);
check("③ 오답 코드 거부", (await p.innerText("body")).includes("올바르지 않습니다"));
await p.fill('input[inputmode="numeric"]', code);
await p.getByRole("button", { name: "인증하고 시작" }).click();
await p.waitForTimeout(2000);
const body2 = await p.innerText("body");
check("③ 인증 후 로그인 완료(채팅 진입)", !body2.includes("이메일 인증") && !body2.includes("로그인"),
  body2.slice(0, 60).replace(/\n/g, " "));
await p.screenshot({ path: "verify-signup-in.png" });

// ④ 관리자 사용자 탭 — admintest로 새 계정이 보이는지 + 메타만
const actx = await b.newContext();
await actx.request.post(BASE + "/api/app/auth/login", {
  data: { username: "admintest", password: "admtest123" },
});
const ap = await actx.newPage();
await ap.goto(BASE + "/admin/#users", { waitUntil: "load" });
await ap.waitForTimeout(2000);
const abody = await ap.innerText("body");
check("④ 사용자 탭 노출(플래그 on)", abody.includes("👥 사용자") || abody.includes("사용자"));
check("④ 신규 가입자 목록 표시", abody.includes(EMAIL));
check("④ 인증 상태 배지", abody.includes("인증됨"));
check("④ 개인정보 고지 문구", abody.includes("채팅 내용은 관리자도 볼 수 없습니다"));
await ap.screenshot({ path: "verify-signup-users.png" });

console.log(`\n${pass}/${pass + fail} 판정 통과`);
await restore(); // 승인제 플래그 원상 복원
await b.close();
process.exit(fail ? 1 : 0);
