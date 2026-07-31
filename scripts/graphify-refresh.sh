#!/usr/bin/env bash
# graphify 코드 그래프 갱신 — 증분 재추출 + 커뮤니티 이름 유지.
#
# 그래프는 커밋에 묶이지 않으면 썩고, 썩으면 안 쓰게 된다. 코드가 꽤 바뀌었다 싶을 때
# 이 스크립트 하나로 갱신한다(수 초 — 증분이라 바뀐 파일만 재파싱).
#
#   scripts/graphify-refresh.sh            # 증분 갱신(LLM 0, 오프라인)
#   scripts/graphify-refresh.sh --label    # + 커뮤니티 이름을 사내 Ollama로 다시 붙임
#
# ⛔ 안전 계약:
#   - LLM 없는 추출만: 코드=tree-sitter, 마크다운=헤딩 구조 파싱 — 둘 다 로컬·결정적
#     (실측 2026-07-31: update가 docs/*.md를 넣지만 문서 노드는 제목+줄번호뿐, 의미 추출 없음.
#      덕분에 설계 문서 66편이 코드와 한 그래프에 연결된다 — 의도된 확장).
#     볼트·PDF·내부 원본 제외는 .gitignore(자동 존중) + .graphifyignore 2중 + 아래 유출 검사.
#   - --label도 외부 API 금지: 사내 공유 Ollama(11434)만. 프로덕션 격리 Ollama(11436)는
#     채팅 상주 모델이 있어 건드리지 않는다.
#   - 산출물 graphify-out/ 는 gitignore — 우리 코드 구조를 공개 레포에 남기지 않는다.
#
# ⚠ 파서 함정(실측 2026-07-31): graphify 플래그는 **등호형**(--backend=ollama)만 읽는다.
#   공백형(--backend ollama)은 조용히 무시돼 기본 백엔드로 빠진다.
#   OLLAMA_BASE_URL은 verbatim이라 **/v1까지** 붙여야 한다(없으면 404).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

G="$HOME/.local/venvs/graphify/bin/graphify"
[ -x "$G" ] || { echo "graphify 없음: $G — python3 -m venv ~/.local/venvs/graphify && pip install graphifyy openai" >&2; exit 1; }

export GRAPHIFY_QUERY_LOG_DISABLE=1   # 질의 원문이 ~/.cache에 쌓이는 것 차단

echo "── 증분 재추출(코드 전용, 오프라인) ──"
# ⚠ update엔 --code-only 플래그가 없다(실측: unknown option) — 명령 자체가 코드 전용이다
#   ("re-extract code files … no LLM needed"). 문서·PDF는 처음부터 update 대상이 아니다.
"$G" update .

if [ "${1:-}" = "--label" ]; then
  echo "── 커뮤니티 이름(사내 Ollama · Qwen3-14B) ──"
  OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 \
    "$G" label . '--backend=ollama' '--model=hf.co/Qwen/Qwen3-14B-GGUF:Q4_K_M'
else
  "$G" cluster-only . --no-label   # 저장된 이름 유지, 재군집·리포트만
fi

echo "── ⛔ 유출 검사(내부 콘텐츠가 그래프에 없어야 함) ──"
bad=0
for pat in 'KEI-행정가이드' 'research_rule_files' 'pms_raw' 'forms-pdf' '규정원문'; do
  if grep -q "$pat" graphify-out/graph.json 2>/dev/null; then
    echo "  ⛔ '$pat' 검출 — 그래프를 배포·공유하지 말 것" >&2; bad=1
  fi
done
[ "$bad" = 0 ] && echo "  ✓ 통과" || exit 1
echo "완료: graphify-out/graph.html · GRAPH_REPORT.md"

# ── --publish: 실험실 게시본 갱신 (specs/09 §2.3~2.4) ──────────────────────
# 유출 검사를 통과한 산출물만 게시본이 된다(위에서 exit 1이면 여기 못 온다).
# ⛔ CDN 치환 필수: graph.html은 vis-network를 unpkg에서 로드하는데, server.js CSP가
#    외부 오리진 스크립트를 전부 차단하므로 치환 없인 화면이 아예 안 뜬다(정책이자 동작 필수).
#    로컬 사본(web/lab-assets/vis-network.min.js, 9.1.6 고정)은 1회 수동 확보 — 스크립트는
#    다운로드하지 않는다(게시 경로에 네트워크 의존을 만들지 않는다).
for a in "$@"; do
  if [ "$a" = "--publish" ]; then
    LAB="web/lab-assets"
    [ -f "$LAB/vis-network.min.js" ] || { echo "⛔ $LAB/vis-network.min.js 없음 — specs/09 §2.3(1회 고정) 확인" >&2; exit 1; }
    sed 's|https://unpkg.com/vis-network@[^"]*|/lab-assets/vis-network.min.js|' \
      graphify-out/graph.html > "$LAB/code-graph.html.tmp"
    if grep -qE '<(script|link)[^>]+(src|href)="https?://' "$LAB/code-graph.html.tmp"; then
      echo "⛔ 외부 로드가 남아 있다 — 게시 중단(specs/09 §2.3)" >&2
      rm -f "$LAB/code-graph.html.tmp"; exit 1
    fi
    mv "$LAB/code-graph.html.tmp" "$LAB/code-graph.html"
    printf '{"commit":"%s","generated":"%s","nodes":%s}\n' \
      "$(git rev-parse --short HEAD)" "$(date +%F)" \
      "$(grep -o '"id"' graphify-out/graph.json | wc -l)" > "$LAB/code-graph.meta.json"
    echo "게시: $LAB/code-graph.html ($(du -h "$LAB/code-graph.html" | cut -f1)) + meta"
  fi
done
