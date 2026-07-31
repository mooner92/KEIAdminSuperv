// verify-lib.mjs — verify-*.mjs 공용 판정 헬퍼.
//
// 배경: 동일한 check() 사본이 21개 파일에 흩어져 있었다(2026-07-31 코드 그래프 중복 조사).
// 출력 형식("✅/❌ 이름 — 상세" · "N/M 판정 통과" · fail시 종료코드 1)은 기존과 **바이트 동일** —
// 이 형식을 파싱하는 습관(로그 grep)이 있을 수 있어 바꾸지 않는다.
//
// 사용:
//   import { makeCheck } from "./verify-lib.mjs";
//   const { check, finish } = makeCheck();
//   check("제목이 보인다", ok, "상세");
//   ...
//   process.exit(finish());   // 요약 출력 + 종료코드 반환(fail ? 1 : 0)
export function makeCheck() {
  let pass = 0, fail = 0;
  const check = (n, ok, d = "") => { console.log((ok ? "✅" : "❌") + " " + n + (d ? " — " + d : "")); ok ? pass++ : fail++; };
  const finish = () => { console.log(`\n${pass}/${pass + fail} 판정 통과`); return fail ? 1 : 0; };
  return { check, finish };
}
