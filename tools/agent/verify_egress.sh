#!/usr/bin/env bash
# verify_egress.sh — 에이전트(omp) 외부망 0 회귀(docs/74, 절대 규칙 5).
#
# 실측(2026-10-06): omp 기본 설정은 기동 시 모델 카탈로그를 **인터넷에서** 갱신한다(443 다수 연결 —
# Cloudflare·Google·Alibaba 대역). refresh("offline") + 죽은 프록시 env로 막았다. omp를 올리면
# (bun update) 반드시 이걸 다시 돌려 루프백 외 connect가 0인지 확인한다.
#
# 방법: 모의 도구 서버 + 실제 에이전트 Ollama로 1문항 실행을 strace(connect)로 감시.
# 사용: tools/agent/verify_egress.sh   (에이전트 Ollama 11438 가동 필요, strace 필요)
set -euo pipefail
cd "$(dirname "$0")"
BUN="${RAG_AGENT_BUN:-$(command -v bun || echo /home/mhchoi/.nvm/versions/node/v22.23.0/bin/bun)}"
TMP="$(mktemp -d)"; trap 'kill $MOCK 2>/dev/null || true; rm -rf "$TMP"' EXIT

cat > "$TMP/mock.py" <<'EOF'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length', 0)))
        out = json.dumps({"text": "[모의규정 제1조]\n제1조(목적) 모의 데이터.", "sources": [{"규정명": "모의규정", "조": "제1조"}]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
s = HTTPServer(('127.0.0.1', 0), H); print(s.server_address[1], flush=True); s.serve_forever()
EOF
python3 "$TMP/mock.py" > "$TMP/port" & MOCK=$!
for _ in $(seq 1 20); do [ -s "$TMP/port" ] && break; sleep 0.2; done
PORT=$(head -1 "$TMP/port")

cat > "$TMP/in.json" <<EOF
{"question":"모의 질문입니다. 목적 조항을 알려줘.","history":[],"system":"검색 도구로 근거를 찾아 한 줄로 답한다.",
 "api":"http://127.0.0.1:$PORT","token":"t","temperature":0.1,
 "model":{"baseUrl":"${RAG_AGENT_LLM_BASE:-http://127.0.0.1:11438/v1}","id":"${RAG_AGENT_LLM:-kei-qwen35-agent:latest}","contextWindow":32768,"maxTokens":256},
 "maxToolCalls":2,"agentDir":"$TMP/omp-home"}
EOF

HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost \
PI_CODING_AGENT_DIR="$TMP/omp-home" PI_NO_TITLE=1 PI_NO_EMBEDDINGS=1 \
  timeout 300 strace -f -qq -e trace=connect -o "$TMP/strace.log" "$BUN" kei_agent.ts < "$TMP/in.json" > "$TMP/out.txt" 2>/dev/null || true

EXT=$(grep -oE 'inet6?_addr\("[^"]+"\)|inet_pton\(AF_INET6?, "[^"]+"' "$TMP/strace.log" \
      | grep -oE '"[^"]+"' | tr -d '"' | grep -vE '^(127\.|::1$|::ffff:127\.)' | sort -u || true)
if [ -n "$EXT" ]; then
  echo "❌ 루프백 외 연결 발견:"; echo "$EXT"; exit 1
fi
grep -q '"answer"' "$TMP/out.txt" || { echo "❌ 에이전트 출력 없음(Ollama 11438 가동 확인)"; tail -3 "$TMP/out.txt"; exit 1; }
echo "✅ 외부망 연결 0 — 루프백만 사용 ($(grep -c 'connect(' "$TMP/strace.log") connect 호출 감시)"
