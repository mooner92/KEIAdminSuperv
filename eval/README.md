# eval/ — RAG 검색 품질 평가 하베스트 (P1.1)

RAG 비서의 **검색 품질을 숫자로** 본다. "좋아졌다"는 주장은 여기 지표(before/after) 없이는 하지 않는다(P1 가드레일).

## 구성
| 파일 | 추적 | 설명 |
|---|---|---|
| `run_eval.py` | ✅ | 평가 엔진. golden을 실제 `rag_core.retrieve`에 통과시켜 Hit@k·Recall@k·MRR 산출 |
| `run.sh` | ✅ | 실행 래퍼(/verify 진입점). 임베딩/벡터DB env 고정, 평가는 CPU로(라이브 GPU 비경쟁) |
| `golden.example.jsonl` | ✅ | 평가셋 **스키마 예시**(가짜 값). 형식만 공개 |
| `golden.jsonl` | ⛔ gitignore | 실제 평가셋. 규정 원문에서 도출한 정답·금액·한도 포함 → 공개 레포 커밋 금지 |
| `reports/` | ⛔ gitignore | 실행 리포트(질문·답변·출처 포함) |

> ⛔ **보안:** `golden.jsonl`·`reports/`는 `chroma/`·`app.db`처럼 **로컬 전용**이다. 내부 규정 내용을
> 담으므로 절대 커밋하지 않는다(루트 `SECURITY.md` · 데이터 분리 원칙). 형식은 `golden.example.jsonl` 참조.

## 평가셋(golden.jsonl) 만드는 규칙 (⛔ 가드레일)
- 정답·기대출처는 **실제 청크에서만** 추출한다. 금액·한도·기한을 **추측해 쓰지 않는다**.
- 사람이 확정하기 전까지 모든 항목 `verified: false`(= 검수상태 미검수). 에이전트는 초안만.
- `expected_sources`는 코퍼스에 실재하는 `(규정명, 조)`. 시스템/용어/가이드 노트는 `조`가
  헤딩 라벨이거나 빈 값 — 빈 값이면 규정명만으로 매칭한다.
- ≥30문항, ≥6개 카테고리 커버. (현재 31문항 / 9개 카테고리)

## 실행
```bash
bash eval/run.sh                 # 검색 지표만(Hit/Recall/MRR) — 빠름(~17s, CPU), LLM 불필요
bash eval/run.sh --judge         # + LLM-as-judge 충실도(근거충실·출처표기·면책) — Ollama 필요, 느림
bash eval/run.sh --tag before    # 리포트 파일명 태그 → before/after 비교
bash eval/run.sh --hybrid        # 하이브리드 검색(밀집+BM25 RRF) 측정 — 현재 이득 없어 기본 off
bash eval/run.sh --rerank        # cross-encoder 리랭커 측정 — strict Hit@1 0.600→0.829 (운영 적용됨)
bash eval/run_eval.py --ks 1,3,5 --topn 20   # 옵션 직접 지정
```

## 지표 읽는 법
- **Hit@k**: 기대 출처가 top-k 안에 하나라도 잡힌 질문 비율.
- **Recall@k**: 질문별 (회수된 기대 출처 / 전체 기대 출처) 평균.
- **MRR**: 첫 적중 출처의 역순위(1/rank) 평균. 1에 가까울수록 상위 노출.
- **strict**(규정명+조) vs **relaxed**(규정명만): 둘의 격차 = "규정은 맞는데 조가 틀림"
  → 리랭커(P1.4)로 줄일 여지. 카테고리별 분해로 약한 영역을 본다.

## before/after 워크플로 (P1.2~P1.4 공통)
```bash
bash eval/run.sh --tag before                     # 변경 전 측정
# … 재임베딩 / 리랭커 / 하이브리드 등 변경 (변경 전 chroma 백업 필수) …
CHROMA_DIR=tools/chroma EMBED_MODEL=... bash eval/run.sh --tag after   # 같은 평가셋으로 재측정
# reports/<ts>-before.json 과 <ts>-after.json 의 summary 비교
```

## 베이스라인 (참고 · 2026-06-20, KURE-v1 + Chroma, 적중 31 + 부정 5)
**검색(retrieval):**
| cutoff | Hit(strict) | Recall | MRR | Hit(relaxed) |
|---|---|---|---|---|
| @1 | 0.677 | 0.677 | 0.677 | 0.903 |
| @3 | 0.935 | 0.935 | 0.790 | 1.000 |
| @5 | 1.000 | 1.000 | 0.803 | 1.000 |

**생성(LLM-judge, `--judge`):** 근거충실 0.935 · 출처표기 0.968 · **면책문구 0.806** · 거부율 0.800(부정 5건) · 근거없는 조문인용 0건.

해석:
- 검색: 올바른 **규정**은 거의 top-1(0.903), 정확한 **조**는 top-3(0.935)/top-5(1.000)에서 회수.
  strict@1(0.677) ↔ relaxed@1(0.903) 격차 = 리랭커(P1.4) 개선 목표 지점.
- 생성 — 관찰(사람 확인됨):
  - **LLM-judge는 그 자체로 불완전**: 충실도 미달 2건(q004·q005)은 점검 결과 **judge 오판**(근거에 실제로 존재).
    → faithfulness는 스크리닝 신호일 뿐, 확정은 사람(가드레일).
  - **면책문구 0.806**: 14B가 마무리 면책 문구를 ~19% 누락 → **결정적 후처리로 보강 가능**(가드레일 강화, before/after 측정).
  - 거부 실패 1건(n03 동호회 활동비): 길라잡이에 동호회 '명단'만 있고 금액 없음에도 **금액을 환각** →
    가장 위험한 실패 모드를 평가셋이 포착. (출처표기 환각은 0건이나, 제N조 아닌 문서명 인용 형태라 별도 주시)
  - 출처표기 0.968의 1건(q030)은 가이드 답변이라 `[규정명 제N조]` 정규식에 안 잡힌 측정 한계(실제 출처는 표기됨).
