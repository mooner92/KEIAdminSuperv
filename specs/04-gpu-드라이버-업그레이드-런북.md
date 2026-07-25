# Spec 04 — GPU 드라이버 535 → 580 업그레이드 런북

> 2026-07-25 작성 · **실행 보류**(사용자 지시: "평일에 물어보고 진행"). 이 문서는 그날 그대로 따라 하는 절차서다.
> 목적: Ollama가 CUDA를 쓰게 해 응답 지연을 줄이고, 더 큰 모델 검토의 문을 연다.

## 1. 진단 — 병목이 드라이버임을 로그로 확정

```
WARN source=cuda_compat.go:65 msg="NVIDIA driver too old"
     device="Quadro RTX 6000" compute=7.5 driver=535 required_driver="550 or newer"
INFO msg="selecting GPU backend for llama-server model" library=Vulkan
```
Ollama v0.31.1이 **CUDA를 의도적으로 거부**하고 Vulkan으로 폴백 중. 드라이버만 올리면 **코드 수정 0**으로 CUDA 경로가 열린다.

**현재 상태(2026-07-25 실측)**

| 항목 | 값 |
|---|---|
| 드라이버 | `535.309.01` (apt: `nvidia-driver-535`, `nvidia-dkms-535`) |
| CUDA 런타임 상한 | 12.2 |
| GPU | Quadro RTX 6000 24GB ×2 (compute 7.5) |
| OS / 커널 | Ubuntu 24.04.4 LTS / 6.8.0-101-generic |
| 배포판 권장 드라이버 | **`nvidia-driver-580`** (`ubuntu-drivers devices`) |
| 응답 지연(기준선) | **중앙값 13.2s · p90 15.2s** (골든 112문 A/B 실측, eval/ab) |

## 2. ⚠ 리스크 — 이 서버는 공용이다

`ps` 전수 확인 결과 **다른 사용자의 서비스가 상시 실행 중**:

| 사용자 | 프로세스 | 영향 |
|---|---|---|
| **jhkim** | **ollama**, gunicorn (6월부터 세션 4개) | GPU 사용 서비스 — 재부팅 시 중단 |
| **dyjin** | reflex(웹앱), node | 재부팅 시 중단 |
| khchoi | 로그인 세션 | — |

⟹ **사전 공지 없이 진행 금지.** 드라이버 교체는 NVIDIA 커널 모듈 언로드가 필요하고, 실질적으로 재부팅이 요구된다.

### 2-1. 🚨 선행 필수 — 우리 서비스도 자동 복구되지 않는다
`systemctl list-unit-files | grep pm2` → **PM2 systemd 유닛 없음**. 지금 재부팅하면 `kei-rag-api`·`kei-guide`·
`kei-ollama-v031` 전부 **수동 기동 전까지 죽은 채로 있다**. 업그레이드 전에 반드시 등록할 것(§4 STEP 0).
> 참고: `/var/run/reboot-required` 가 이미 존재 — 이전 커널 업데이트로 재부팅이 밀려 있는 상태.

## 3. 사전 공지 문안(그대로 복사)

> [GPU 서버 점검 공지] N월 N일(요일) HH:MM ~ HH:40, GPU 드라이버 업데이트로 **서버를 재부팅**합니다.
> 그동안 GPU·웹 서비스가 중단되며, 재부팅 후 각자 서비스가 자동 기동되는지 확인 부탁드립니다.
> (사유: AI 서비스가 CUDA를 못 써 Vulkan으로 우회 중 — 드라이버 580으로 올려 정상화)

대상: jhkim, dyjin, khchoi + 서버 관리자. 확인할 것 ⓐ 정비 시간대 합의 ⓑ 각자 서비스 자동기동 여부 ⓒ 구 CUDA 빌드 의존 여부.

## 4. 절차

### STEP 0 — 자동 복구 등록(재부팅 전 필수)
```bash
pm2 save                                   # 현재 프로세스 목록 스냅샷
pm2 startup systemd -u $USER --hp $HOME    # 출력되는 sudo 명령을 그대로 실행
systemctl list-unit-files | grep pm2       # pm2-mhchoi.service 확인 = 등록 성공
```

### STEP 1 — 백업·기록
```bash
TS=$(date +%Y%m%d-%H%M%S)
nvidia-smi -q > ~/kei-backups/gpu-before-$TS.txt
dpkg -l | grep -i nvidia > ~/kei-backups/nvidia-pkgs-before-$TS.txt
tar czf ~/kei-backups/prod-pre-driver-$TS.tgz -C /KEIAdminSuperv tools/app.db tools/index
```

### STEP 2 — 서비스 정지(우리 것)
```bash
pm2 stop kei-rag-api kei-guide kei-rag-api-dev kei-guide-dev kei-ollama-v031
```

### STEP 3 — 드라이버 교체
```bash
sudo apt-get update
sudo apt-get install -y nvidia-driver-580        # 배포판 권장(dkms 자동 동반)
# 구버전 메타패키지가 남으면: sudo apt-get autoremove --purge nvidia-driver-535
dkms status | grep nvidia                         # 새 모듈 빌드 확인
```

### STEP 4 — 재부팅
```bash
sudo reboot
```

### STEP 5 — 복구·검증 (재부팅 후)
```bash
nvidia-smi --query-gpu=driver_version --format=csv,noheader    # 580.x 확인
pm2 resurrect || pm2 start /KEIAdminSuperv/tools/ecosystem.config.js
pm2 list                                                        # kei-* 전부 online

# ① CUDA 채택 확인(핵심) — Vulkan이 아니라 CUDA여야 성공
grep -a "selecting GPU backend" ~/.pm2/logs/kei-ollama-v031-error-*.log | tail -2
#   기대: library=CUDA   /  실패: library=Vulkan + "driver too old"

# ② 서비스 정상
curl -s -o /dev/null -w "api=%{http_code}\n" http://127.0.0.1:9000/v1/models
curl -s -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3100/
cd /KEIAdminSuperv/tools && RAG_API=http://127.0.0.1:9000 \
  APP_TEST_BASE=http://127.0.0.1:9000/app APP_TEST_USER=<임시계정> APP_TEST_PASS=<pw> \
  .venv/bin/python verify_trust_gates.py            # 6/6 통과
```

### STEP 6 — 성능 재측정(효과 입증)
```bash
cd /home/mhchoi/kei-dev-0703/eval
LLM_MODEL=hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M ../tools/.venv/bin/python ab_model_test.py --tag qwen35_cuda
# 기준선 대비 지연 중앙값 13.2s → ? (같은 112문항·같은 코드 — 공정 비교)
```
결과를 `docs/15` §10에 기록. 개선이 확인되면 **더 큰 모델(27B급) 검토**를 재개할 근거가 된다(specs/05 후보).

## 5. 롤백
```bash
sudo apt-get install -y nvidia-driver-535   # 구버전 재설치
sudo reboot
```
드라이버 교체는 apt 패키지 단위라 되돌리기 쉽다. **되돌리기 어려운 쪽은 재부팅 그 자체**(타 사용자 서비스 중단)이므로
§3 공지가 실질적 안전장치다.

## 6. 체크리스트(그날 이것만 보면 됨)
- [ ] jhkim·dyjin·관리자에게 공지, 시간대 합의
- [ ] STEP 0 — `pm2 startup` 등록 확인(**미등록 상태로 재부팅 금지**)
- [ ] STEP 1 백업 3종
- [ ] STEP 3 설치 후 `dkms status` 확인
- [ ] 재부팅 후 `library=CUDA` 로그 확인 ← **성공 판정 기준**
- [ ] 신뢰 게이트 6/6 · web/api 200
- [ ] 지연 재측정 후 docs/15 기록
