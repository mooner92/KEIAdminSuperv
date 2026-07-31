# ServiceDown / ServiceRecovered — 서비스 이상·복구

**증상**: 사용자가 질문을 보내도 답이 안 온다(빈 답변 또는 500).
**감지**: `obs.health_probe` — ⓐ 캐시된 chroma 핸들로 `count()` ⓑ Ollama `/api/tags` 200. 4분 주기, **상태 전이에만** 발화.

## 1. 어느 쪽이 죽었는지 본다
알림 2줄의 사유를 먼저 읽는다 — `벡터DB 이상: <예외형>` 또는 `LLM(Ollama) 연결 실패`.

```bash
pm2 list | grep -E 'kei-rag-api|kei-ollama'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:11436/api/tags   # LLM
curl -s http://127.0.0.1:9000/healthz 2>/dev/null | head -c 200            # API
```

## 2. 가장 흔한 원인 — 재색인 후 stale 핸들
**실측 사고**: 재색인하고 API를 재기동하지 않아 옛 chroma 컬렉션 핸들을 물고 채팅이 전부 500이었다.
이 알림이 만들어진 계기다. 재색인·인덱스 갱신을 했다면 **거의 이것**이다.

```bash
pm2 restart kei-rag-api    # 모델 재로드 ~30초, 그동안 첫 질문이 느리다
```

## 3. LLM이 원인이면
```bash
pm2 restart kei-ollama-v031
nvidia-smi                 # ⚠ GPU는 공유·변동적 — 남이 다 쓰고 있으면 상주 실패한다
curl -s http://127.0.0.1:11436/api/ps    # 모델이 올라와 있나
```

## 4. 확인
질문 하나를 실제로 보내 본다. 회복되면 `ServiceRecovered`(⚪ SEV3)가 자동으로 온다 — **그게 오기 전엔 끝난 게 아니다.**

## 안 해도 되는 것
- 이상이 유지되는 동안 재알림은 오지 않는다(전이만 발화). 조용하다고 나은 게 아니다.
- `UnhandledError`(500)가 같이 왔다면 무시한다 — 이 알림에 `inhibited_by`로 묶여 있고, LLM이 죽었으면 500은 결과다.
