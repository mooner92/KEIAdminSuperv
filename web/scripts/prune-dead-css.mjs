// prune-dead-css.mjs — CSS 모듈에서 **tsx가 참조하지 않는** 클래스 규칙을 제거(specs/03 B4).
// 안전장치: ① 선두 셀렉터가 대상 클래스인 규칙만 삭제(자손·조합 셀렉터는 보존)
//          ② tsx 전수 스캔으로 참조 여부 판정(styles.x · s.x · f.x · ["x"] 형태 모두)
//          ③ --dry 기본, --write 있을 때만 기록. 실행 후 빌드+실렌더로 검증할 것.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const write = process.argv.includes("--write");
const targets = process.argv.filter((a) => a.endsWith(".module.css"));

const tsx = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next|out/.test(p)) walk(p); }
    else if (/\.(tsx|ts|mjs)$/.test(e.name)) tsx.push(fs.readFileSync(p, "utf-8"));
  }
};
walk(path.join(ROOT, "components"));
walk(path.join(ROOT, "pages"));
const code = tsx.join("\n");

let totalRemoved = 0;
for (const rel of targets) {
  const file = path.join(ROOT, rel);
  const css = fs.readFileSync(file, "utf-8");
  const classes = [...new Set([...css.matchAll(/^\s*\.([A-Za-z][\w-]*)/gm)].map((m) => m[1]))];
  const dead = classes.filter((c) =>
    !new RegExp(`[\\w]\\.${c}\\b|\\["${c}"\\]|\\['${c}'\\]|\`\\$\\{[^}]*\\.${c}\\b`).test(code));
  if (!dead.length) { console.log(`${rel}: 제거 대상 없음`); continue; }
  // 규칙 블록 단위 스캔 — 선두 셀렉터가 dead 클래스인 것만 삭제
  let out = "", i = 0, removed = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) { out += css.slice(i); break; }
    const close = css.indexOf("}", open);
    if (close < 0) { out += css.slice(i); break; }
    const selRaw = css.slice(i, open);
    const sel = selRaw.trim();
    const lead = sel.split(",")[0].trim().match(/^\.([A-Za-z][\w-]*)/);
    const isDead = lead && dead.includes(lead[1]) &&
      sel.split(",").every((s) => { const m = s.trim().match(/^\.([A-Za-z][\w-]*)/); return m && dead.includes(m[1]); });
    if (isDead && !/@media|@supports/.test(selRaw)) { removed++; i = close + 1; continue; }
    out += css.slice(i, close + 1);
    i = close + 1;
  }
  out = out.replace(/\n{3,}/g, "\n\n");
  console.log(`${rel}: 미참조 ${dead.length}개 · 규칙 ${removed}개 제거${write ? " (기록)" : " [dry]"}`);
  totalRemoved += removed;
  if (write) fs.writeFileSync(file, out, "utf-8");
}
console.log(`총 ${totalRemoved} 규칙${write ? " 제거" : " 제거 예정"}`);
