#!/usr/bin/env python3
"""test_action_expand.py — 행위 흐름 1홉 확장(ACTION_FLOWS) 단위·통합 테스트 (dev 로컬).

검증:
  1) 인덱스: ACTION_FLOWS 페어가 코퍼스 실청크로 해석되는가(둘 다 존재하는 페어만 활성)
  2) 확장 on: '국내출장 신청' 회수 → 후속 '정산' 청크가 자동 첨부되는가(graph_expand_action 표식)
  3) 확장 off: env 오버라이드로 끄면 첨부가 없는가(기존 동작 불변)
실행: RAG_RERANK=0 .venv/bin/python eval/test_action_expand.py   (dev chroma 필요)
"""
import os, sys
os.environ.setdefault("CHROMA_DIR", "/home/mhchoi/kei-dev-0703/tools/chroma")
os.environ.setdefault("RAG_COLLECTION", "kei_regs")
os.environ.setdefault("EMBED_MODEL", "nlpai-lab/KURE-v1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("RAG_RERANK", "0")
sys.path.insert(0, "/home/mhchoi/kei-dev-0703/tools")
import rag_core

fails = []
def ok(c, m):
    print(("✅ " if c else "❌ ") + m)
    if not c: fails.append(m)

# 1) 인덱스 해석
idx, amap = rag_core._ensure_action_index()
print(f"활성 페어 from-키: {sorted(idx.keys())}")
ok(len(idx) >= 4, f"1) ACTION_FLOWS 페어가 실청크로 해석됨({len(idx)}개 from-키)")
ok("국내출장신청" in idx, "1b) 국내출장신청→정산 페어 활성")
ok("연장근로신청" in idx or "연장근로현황" in idx, "1c) 연장근로→결과보고 페어 활성")
for frm, targets in sorted(idx.items()):
    for cid, rel in targets:
        d, m = amap[cid]
        print(f"    {frm} ──{rel}──▶ {m.get('규정명')} {m.get('조')}")

# 2) 확장 on (env 강제)
os.environ["RAG_GRAPH_EXPAND_ACTIONS"] = "1"
ctx, srcs = rag_core.retrieve("ERP에서 국내출장 신청하는 방법 알려줘")
attached = [s for s in srcs if s.get("graph_expand_action")]
labels = [f"{s['규정명']} {s['조']}" for s in srcs]
print("회수:", labels)
ok(any("국내출장" in (s.get("조") or "") for s in srcs), "2a) 국내출장 신청 화면 회수")
ok(len(attached) >= 1 and any("정산" in (s.get("조") or "") for s in attached),
   f"2b) 후속 '정산' 청크 자동첨부({[s['조'] for s in attached]})")
ok("후속 단계" in ctx, "2c) 근거 블록에 '후속 단계' 라벨 포함")

# 3) 확장 off
os.environ["RAG_GRAPH_EXPAND_ACTIONS"] = "0"
_, srcs_off = rag_core.retrieve("ERP에서 국내출장 신청하는 방법 알려줘")
ok(not any(s.get("graph_expand_action") for s in srcs_off), "3) off면 첨부 없음(기존 동작 불변)")

print("\n" + ("❌ FAIL: " + " / ".join(fails) if fails else "✅ 행위 흐름 확장 테스트 전체 통과"))
sys.exit(1 if fails else 0)
