"""리랭커 어휘 함정 가드(밀집 안전석·충돌 강등) 회귀 테스트 — docs/12 P1.4 보강.

실측 결함(2026-07-16): '초과근무 수당 지급 기준' 질의에서 cross-encoder가
'수당 지급 기준' 표면 일치(가족수당·명예퇴직수당)에 끌려 밀집 정답(보수규정
제15조의3·연장근로등관리규칙)을 top-k 밖으로 퇴출 → 챗봇 거부. 가드 후에는
핵심 조문이 컨텍스트에 반드시 포함되어야 한다.

실행: cd tools && CHROMA_DIR=... .venv/bin/python test_rerank_keepdense.py
(모델·chroma 필요 — 없으면 skip)
"""
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")

def main():
    if not os.path.isdir(os.environ.get("CHROMA_DIR", "chroma")):
        print("skip: chroma 없음")
        return 0
    import rag_core
    q = "초과근무 수당 지급 기준이 궁금해요."
    _, srcs = rag_core.retrieve(q, k=5, rerank=True)
    names = [f"{s.get('규정명','')} {s.get('조','')}".strip() for s in srcs[:5]]
    print("top-5:", names)
    ok = True
    def has(frag):
        return any(frag in n for n in names)
    for frag in ["보수규정 제15조의3", "연장근로등관리규칙 제6조", "연장근로등관리규칙 제3조"]:
        if not has(frag):
            print(f"❌ 핵심 근거 누락: {frag}")
            ok = False
    # 충돌 강등 시 밀집 우선 배치 — 첫 근거는 수당 노이즈가 아니어야 한다
    if names and any(noise in names[0] for noise in ["가족수당", "명예퇴직", "능률성과급"]):
        print(f"❌ 첫 근거가 어휘 함정 문서: {names[0]}")
        ok = False
    # 대조군: 리랭커가 정상 동작하는 질의는 불변이어야 한다(가족수당 질의 → 가족수당 문서 상위)
    _, srcs2 = rag_core.retrieve("가족수당은 얼마 받아요?", k=5, rerank=True)
    names2 = [f"{s.get('규정명','')}".strip() for s in srcs2[:3]]
    if not any("가족수당" in n or "보수규정" in n for n in names2):
        print(f"❌ 대조군 회귀: {names2}")
        ok = False
    print("✅ 통과" if ok else "❌ 실패")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
