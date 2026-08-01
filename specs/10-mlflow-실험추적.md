# Spec 10 — MLflow 실험 추적: 개념 정리 + 일일 자가평가 통합

> 2026-08-02 · 목적 이중: ⓐ 수제 실험추적(jsonl 뒤지기)의 한계를 표준 도구로 보완
> ⓑ 운영자 커리어 준비(ML Ops 도구 실사용 경험 — 문서 읽기가 아니라 우리 실데이터에 적용).
> 관련: docs/58(자가평가 — 데이터 원천) · eval/ab_model_test.py(A/B — 두 번째 소비자).

## 0. 배경 — 우리가 이미 하고 있는 것과 아픈 곳

이 프로젝트는 실험추적을 **수제로** 해 왔다:
- 일일 자가평가 → `eval/daily/<date>.graded.json` (정답률·코호트·실패유형)
- 모델 A/B → `eval/ab*` 산출물 (Qwen2.5→3→3.5 교체 근거: 값정확도 57.3% vs 40.8%)
- 검색 실험 → 커밋 메시지·docs에 산재 (리랭커 Hit@1 0.600→0.829, 검색라벨 78→80)

**아픈 곳(실측)**: "리랭커 켠 날과 끈 날 비교"·"컬렉션 v2→v4 전후 비교" 같은 질문마다
파일을 손으로 뒤지고 즉석 파이썬을 짠다(2026-08-01 약점 매트릭스도 즉석 계산이었다).
구성(params)과 결과(metrics)가 **한 곳에 짝지어 저장돼 있지 않아서**다. 그게 MLflow
Tracking이 푸는 문제 정확히 그것이다.

## 1. MLflow 핵심 개념 정리 (학습 노트 — 면접 대비 겸용)

### 1.1 네 가지 컴포넌트

| 컴포넌트 | 역할 | 우리에게 |
|---|---|---|
| **Tracking** | 실험 기록: params·metrics·artifacts를 run 단위로 | ✅ **채택 대상** — 자가평가·A/B 기록 |
| **Models** | 모델 패키징 표준(pyfunc·flavor·signature) | ⏸ 참고만 — 우리 모델은 Ollama GGUF(패키징 불필요) |
| **Model Registry** | 모델 버전·별칭(champion/challenger)·승격 워크플로 | ⏸ 개념만 — 우리 '모델 교체'는 ecosystem env |
| **Projects** | 재현 가능한 실행 패키징(MLproject) | ❌ 비목표 — 크론+스크립트로 충분 |

### 1.2 Tracking의 데이터 모델 (제일 중요)

```
Experiment (실험 묶음, 예: "daily-eval")
 └─ Run (1회 실행, 예: 2026-08-02 크론)
     ├─ params   : 불변 구성 — 문자열 키/값 (모델명, 컬렉션, 리랭커 on/off, 플래그)
     ├─ metrics  : 수치 결과 — step 축으로 시계열 가능 (정답률, 코호트별, 실패유형 건수)
     ├─ tags     : 메타 (git commit, 트리거=cron|manual)
     └─ artifacts: 파일 원본 (graded.json 사본, 리포트)
```

- **params vs metrics 구분이 본질**: "무엇을 다르게 했나"(param) ↔ "무엇이 나왔나"(metric).
  UI에서 run들을 param으로 필터하고 metric으로 정렬하는 게 이 도구의 가치 전부다.
- **저장 구조 2층**: backend store(메타·metrics — 파일/SQLite/DB)와 artifact store(파일).
  ⚠ **실측(3.15, 2026-08-02)**: 파일 스토어(`mlruns/`)는 유지보수 모드로 강등 — 기본이 예외를
  던진다. **sqlite 백엔드(`sqlite:///mlflow.db`)가 권장 경로**이고 여전히 서버 프로세스 없이
  동작한다(artifact는 계속 디렉터리). UI가 필요할 때만 `mlflow ui --backend-store-uri`로 연다.
- **autolog**: sklearn·pytorch 등 학습 프레임워크의 파라미터·지표를 자동 후킹.
  ⚠ 우리 파이프라인은 학습이 아니라 평가라 autolog 대상이 아니다 — **수동 API**
  (`start_run`/`log_params`/`log_metrics`/`log_artifact`)가 우리 경로다.

### 1.3 API 최소 표면 (우리가 쓸 전부)

```python
import mlflow
mlflow.set_tracking_uri("sqlite:///eval/mlflow.db")  # sqlite 백엔드(서버 불요 — 3.15 실측)
mlflow.set_experiment("daily-eval")
with mlflow.start_run(run_name="2026-08-02"):
    mlflow.log_params({"llm": "Qwen3.5-9B-Q4", "collection": "kei_regs", "rerank": 1})
    mlflow.log_metrics({"정답률": 89.1, "재시험": 88.9, "신규": 89.2, "출제결함": 1})
    mlflow.set_tags({"git": "95ead80", "trigger": "cron"})
    mlflow.log_artifact("daily/2026-08-02.graded.json")
# 비교 UI: cd eval && mlflow ui --port 5000  (필요할 때만, 127.0.0.1)
```

### 1.4 Registry·서빙은 개념만 (면접 어휘)

- 버전 등록 → 별칭(`@champion`) 지정 → 서빙이 별칭을 참조 → 새 버전 검증 후 별칭 이동
  = **모델 교체를 코드 배포와 분리**하는 패턴. 우리는 같은 문제를 ecosystem env +
  A/B 감사로 풀었다 — "레지스트리가 해주는 걸 우리는 어떻게 했나"로 말할 수 있으면 된다.
- `mlflow.evaluate`/GenAI 트레이싱(3.x): LLM 평가 내장 기능 — 우리 자가평가(골든·코호트)가
  이미 그 역할이라 도입 대상 아님. 존재만 알아둔다.

## 2. 통합 설계 — 최소 침습 원칙

**⛔ 크론의 정본 산출물은 그대로**(graded.json·게시판) — MLflow는 **병행 기록**이다.
기록 실패가 크론을 죽이면 안 된다(alerts와 같은 fail-safe 사상).

```
daily_run.sh
  … daily_publish …
  $PY mlflow_log.py --date $DATE || true     ← 신설 훅(digest 훅과 나란히)
```

- `eval/mlflow_log.py`: graded.json 1개 → run 1개. params는 **당시 실구성**을
  env·ecosystem에서 수집(모델명·컬렉션·RAG_RERANK — 재현성의 핵심), metrics는
  정답률·코호트·실패유형 전개, artifact로 graded.json 사본.
- **백필**: 기존 `daily/*.graded.json` 전부를 소급 기록(당시 param은 아는 범위만 —
  모르는 값은 기록하지 않지 추측하지 않는다. ⛔절대규칙 1과 동형).
- A/B(`ab_model_test.py`)는 experiment `model-ab`로 분리 — 변형 1개 = run 1개.
- 저장 위치 `eval/mlruns/` — **gitignore**(질문·답변 본문이 artifact에 들어가므로
  공개 레포 금지. 게시판 k-익명 원칙과 동일 계열).

## 3. 비목표

- 원격 tracking server·인증 — 1인 운영에 과함. 로컬 sqlite로 시작(3.15 실측 반영).
- Model Registry 실연결·pyfunc 서빙 — 서빙은 Ollama가 정본.
- 기존 게시판 대체 — 게시판은 사용자용, MLflow는 운영자 실험 비교용. 역할이 다르다.

## 4. Tasks

- [x] T01 이 spec(개념 정리 + 설계)
- [x] T02 `pip install mlflow`(venv 3.15.0) + `eval/mlflow_log.py` + gitignore + daily_run 훅
- [x] T03 백필 — 12건 소급 기록·search_runs 조회 검증(코호트 지표가 07-30b부터만 존재 — 도입 시점이 데이터에 남음)
- [ ] T04 ab_model_test 연동(experiment `model-ab`)
- [ ] T05 치트시트(docs) — UI 띄우기·비교 쿼리·"언제 MLflow, 언제 게시판"

## 5. 커리어 노트 (이 spec의 두 번째 목적)

면접 문장으로 정리해 둘 것:
- "수제 jsonl로 시작해 한계(구성-결과 미짝지음)를 **겪은 뒤** MLflow를 붙였다 —
  도구가 무슨 문제를 푸는지 몸으로 안다."
- "autolog가 아니라 수동 API를 썼다 — 평가 파이프라인이라 학습 후킹이 없기 때문.
  어느 API가 왜 우리 경로인지 판단했다."
- "Registry는 안 썼다 — 모델 교체가 env 전환+A/B 감사로 이미 통제되고, 1인 운영에서
  버전 별칭 워크플로는 과했다. 팀 규모가 되면 그때가 도입 시점."
