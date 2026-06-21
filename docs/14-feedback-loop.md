# 14. 답변 피드백 루프 (Feedback Loop)

> 실사용에서 나온 **👍/👎 신호를 품질 파이프라인으로 환류**시킨다. 오프라인 평가셋(`eval/golden.jsonl`)만으로는 알 수 없는 "현장에서 실제로 틀리거나 부족한 답"을 사람이 검수할 대상으로 끌어올린다.
> 한 줄: **사용자가 답을 평가 → `app.db`에 저장 → `feedback_export.py`로 신호화 → `review_queue.py`가 자주 틀린 규정을 검수 큐 상단으로.**

관련: [05-rag-design.md](05-rag-design.md)(검색·가드레일) · [12-품질강화.md](12-품질강화.md)(평가·검수 큐) · [13-feature-flags.md](13-feature-flags.md)(같은 `/app/*` 백엔드 패턴).

---

## 1. 왜 필요한가

지금까지 품질 개선은 전부 **오프라인 추측**이었다. `eval/golden.jsonl`(44문항)은 우리가 미리 적은 질문이고, 검수 큐(`review_queue.py`)는 노트의 정적 속성(유형·별표·미분류·피인용)으로만 우선순위를 매겼다. 정작 **신입이 실제로 무엇을 묻고, 어떤 답이 틀렸는지**는 데이터가 없었다.

피드백 루프는 이 공백을 메운다. 비용은 작고(버튼 2개 + 테이블 1개) 레버리지는 크다 — 채팅 영속화·메시지별 근거 저장·검수 큐가 **이미** 있으므로, "신호를 받아 잇기"만 하면 시스템이 스스로 좋아지는 토대가 생긴다. 이후 [운영자 대시보드](08-roadmap.md)와 평가셋 확장도 이 데이터를 먹는다.

```mermaid
flowchart LR
    U["💬 사용자<br/>답변에 👍/👎(+사유)"] -->|POST /app/messages/{id}/feedback| DB["🗄️ app.db<br/>Feedback 테이블"]
    DB -->|feedback_export.py| SIG[".feedback_signals.json<br/>(규정별 👎 집계)"]
    SIG -->|review_queue.py --feedback| Q["📋 검수 큐<br/>자주 틀린 규정 ↑"]
    Q -->|사람만 검수 확정| Vault["📁 볼트 수정/검수완료"]
    DB -.->|GET /app/feedback (관리자)| Dash["📊 운영자 대시보드(예정)"]
```

---

## 2. ⛔ 가드레일

피드백은 **품질 신호일 뿐, 진실원천을 자동으로 바꾸지 않는다.** [CLAUDE.md](../CLAUDE.md) 절대 규칙과 정합:

1. **검수상태 자동변경 금지.** 👎가 아무리 많아도 노트의 `검수상태`(미검수→검수완료)나 본문은 코드가 바꾸지 않는다. 피드백은 `review_queue.py`의 **순서**만 바꾼다. 확정은 사람만.
2. **소유 격리.** 사용자는 자기 대화의 답변에만 피드백할 수 있다(세션 소유 검증, 남의 메시지 404).
3. **민감정보 격리.** 사유 텍스트·집계 파일(`.feedback_signals.json`)·`app.db`는 규정 스니펫/사용자 입력을 담으므로 전부 **gitignore**. 관리자 집계 엔드포인트(`GET /app/feedback`)는 `current_admin`으로만 노출.
4. **가드레일 불변.** 피드백 기능은 RAG 답변 생성 경로(근거주입·"근거에 없으면 확인되지 않습니다"·면책)를 전혀 건드리지 않는다.

---

## 3. 데이터 모델 (`tools/app_api.py`)

```python
class Feedback(SQLModel, table=True):
    id: int | None
    message_id: int   # 대상 assistant 메시지
    session_id: int   # 소유 검증·집계용
    user_id: int      # 사용자당·메시지당 1건
    rating: str       # "up" | "down"
    reason: str = ""  # 선택(👎일 때 무엇이 부족했는지, ≤500자)
    created_at / updated_at: float
```

- **사용자당·메시지당 1건** — 코드 레벨 upsert(`(message_id, user_id)`로 조회 후 갱신/삽입). 다시 누르면 갱신, 같은 값 재요청은 프론트에서 철회로 토글.
- 신규 테이블이라 기존 `Message` 스키마 변경 없음 → SQLite 마이그레이션 불필요(`init_db()`의 `create_all`이 새 테이블만 추가). 메시지의 피드백 상태는 조회 시 `Feedback`에서 조인해 `_msg()`에 실어 보낸다.

---

## 4. API (`/app/*`, server.js가 `/api/app/*`로 프록시)

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `POST /app/messages/{mid}/feedback` | 본인 | `{rating, reason?}` upsert. rating∈{up,down} 아니면 400, assistant 아니면 400, 남/없는 메시지 404 |
| `DELETE /app/messages/{mid}/feedback` | 본인 | 철회(없어도 200) |
| `GET /app/feedback?rating=&limit=` | **관리자** | 피드백 원시 목록(질문·답변 요약·근거 규정 포함). 콘텐츠 갭/오답 검수 데이터원 |
| `GET /app/chats/{cid}` | 본인 | 메시지마다 `feedback`·`feedback_reason` 포함(재방문 시 상태 복원) |

프론트 클라이언트: `web/lib/api.ts`의 `api.sendFeedback / clearFeedback / feedbackList`.

---

## 5. UI (`web/components/ChatApp.tsx`)

- 각 **영속 답변(메시지 id>0)** 아래 👍/👎 버튼. 스트리밍 중 임시 메시지(id<0)에는 안 뜬다(완료 후 등장).
- 👎를 누르면 사유 입력창이 열린다(Enter 제출/Esc·건너뛰기 취소, ≤500자). 사유는 선택.
- 같은 버튼을 다시 누르면 **철회(toggle)**. 👍↔👎는 상호배타. 상태는 `aria-pressed`로 노출(접근성·검증).
- 새로고침해도 상태·사유 유지(서버가 진실원천, 낙관적 변경은 실패 시 남기지 않음).
- 색은 KEI 시맨틱 토큰만 사용 → **다크모드 자동 대응**([design-system.md](design-system.md)).

---

## 6. 검수 큐 연동 (read-only)

```bash
# 1) app.db의 피드백을 신호로 내보낸다(읽기 전용, sqlite3 직접 read)
python tools/feedback_export.py            # → tools/.feedback_signals.json (gitignore)

# 2) 검수 큐가 신호를 자동 반영(파일 있으면 👎 받은 규정 우선순위↑, 없으면 조용히 skip)
python tools/review_queue.py --vault KEI-행정가이드 --top 30
```

- **신호 형태**: `{ totals:{up,down}, by_regulation:{ 규정명:{down,up,조[],사유[]} } }`. 한 답변에 같은 규정이 여러 번 인용돼도 1회만 가산.
- **점수 가산**: `review_queue.py`에서 `+min(2·down, 20)`. 기존 가중치(유형/별표/미분류/피인용)에 더해져, 실사용에서 자주 틀린 규정이 위로 올라온다. 콘솔에 `👎` 열과 집계 추가.
- **graceful**: 신호 파일이 없거나 깨져도 큐는 정상 동작(opt-in, 경고만).

> [!note]
> 검수 큐 → 검수 확정 → 볼트 수정은 [12-품질강화.md](12-품질강화.md)의 P1.2 워크플로를 그대로 따른다. 피드백은 그 줄의 *맨 앞 정렬*만 거든다.

---

## 7. 테스트

| 종류 | 파일 | 커버리지 |
|---|---|---|
| 백엔드(LLM 불필요) | `tools/test_feedback.py` | upsert·toggle·사유 영속·잘못된 rating(400)·user메시지(400)·없는·남의 메시지(404)·관리자 집계·비관리자 403·철회·export 집계 (16/16) |
| 프론트 실렌더 | `web/verify-feedback.mjs` | 로그인→질문→👍→새로고침 영속→👎+사유→상호배타→사유 영속 (Playwright) |

```bash
cd tools && .venv/bin/python test_feedback.py
cd web && node verify-feedback.mjs        # dev 3100/9000 가동 상태에서
```

---

## 8. 알려진 한계 / 다음

- **집계 수동 실행.** `feedback_export.py`는 cron/수동 실행. 실시간이 필요하면 `review_queue.py`가 `app.db`를 직접 읽도록 확장 가능(현재는 신호파일 경유로 결합도 최소화).
- **규정명 매칭.** 신호는 `규정명` 문자열로 검수 큐 노트(`규정명/제목`)와 매칭. 동명이의·표기 변형은 놓칠 수 있음(현 코퍼스에선 충돌 없음).
- **대시보드 미구현.** `GET /app/feedback`까지만 제공. 인기질문·거부율·👎율 시각화는 [로드맵](08-roadmap.md)의 운영자 대시보드에서 이 엔드포인트를 소비한다.
- **익명성.** 피드백에 `user_id`가 남는다(소유·중복방지에 필요). 관리자 집계는 사번을 노출하지 않고 질문·답변·규정만 보여준다.

---

## 관련 문서

- ◀️ 이전: [13-feature-flags.md](13-feature-flags.md)
- 🔼 상위: [README.md](README.md) · [../CLAUDE.md](../CLAUDE.md)
- 🔗 함께: [12-품질강화.md](12-품질강화.md)(검수 큐) · [05-rag-design.md](05-rag-design.md)(가드레일) · [08-roadmap.md](08-roadmap.md)(대시보드)

최종 수정: 2026-06-21
