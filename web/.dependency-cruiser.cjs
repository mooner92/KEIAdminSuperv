/** 레이어 경계 규칙(docs/53 컴포넌트 패키지 구조의 코드화) — npm run lint:deps
 *  방향: pages → components → lib. 역방향 금지(madge R1에서 실측된 순환의 재발 방지). */
module.exports = {
  forbidden: [
    {
      name: "components-no-pages",
      comment: "컴포넌트가 pages를 import하면 순환·레이어 위반(JourneyChip 사건, docs/61 R1)",
      severity: "error",
      from: { path: "^components" },
      to: { path: "^pages" },
    },
    {
      name: "lib-no-ui",
      comment: "lib(순수 로직)는 UI(components/pages)를 몰라야 한다",
      severity: "error",
      from: { path: "^lib" },
      to: { path: "^(components|pages)" },
    },
    {
      name: "common-no-feature",
      comment: "components/common(프리미티브)은 기능 컴포넌트(admin 등)를 import 금지",
      severity: "error",
      from: { path: "^components/common" },
      to: { path: "^components/(admin|now|calendar|deadlines|mobile|reader)" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.module\\.css$|node_modules|verify-.*\\.mjs" },
  },
};
