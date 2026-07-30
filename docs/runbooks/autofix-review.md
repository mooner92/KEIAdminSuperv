# AutofixReady / AutofixFailed — 오토픽스 결과

**감지**: `maint_executor` — 격리 worktree에서 무인 Claude Code가 제보를 수정하고 결정적 관문을 통과했을 때(`AutofixReady`) 또는 탈락했을 때(`AutofixFailed`).
**⛔ 라이브 무접촉·머지는 사람이 한다.** 이 알림은 "사람 차례"라는 신호다.

## AutofixReady — 검토하고 머지
1. `/admin` 의견함에서 해당 제보의 compare URL을 연다(브랜치 `autofix/<id>`).
2. **관문이 통과했다는 건 "안전하다"가 아니라 "명백히 위험하진 않다"는 뜻이다.** 직접 본다:
   - 금지구역(볼트·`SYSTEM` 가드레일·시크릿)을 건드렸나 → 관문이 막지만 눈으로도 확인
   - 제보가 말한 문제를 **실제로** 고쳤나 (관문은 구문·회귀만 본다)
   - 사용자 노출 변경이면 패치노트가 붙었나(`changelog_lint`)
3. 머지 후 `main → dev` 백머지를 잊지 않는다(docs/60 §4-4).

## AutofixFailed — 어느 관문인지 보고 손으로
```bash
pm2 logs kei-rag-api --lines 300 --nostream | grep -A10 'autofix'
ls tools/index/autofix/          # 실행 로그·diff 스테이징
```
| 탈락 관문 | 뜻 | 대응 |
|---|---|---|
| 금지구역 diff | 볼트·가드레일을 건드렸다 | ⛔ 자동수정 부적합 — 손으로 |
| SYSTEM 가드레일 AST | 프롬프트 규칙이 바뀌었다 | ⛔ 절대규칙 4 위반 시도 — 손으로 |
| 구문·회귀·웹빌드 | 코드가 깨졌다 | 제보를 직접 처리 |

## 예산
월 상한 `AUTOFIX_BUDGET_USD`(기본 20). 상한에 걸리면 트리거 자체가 안 돈다 — 알림이 안 오는 것과 구분할 것.
