# 보안 정책 (Security Policy)

> **TL;DR** — 이 공개 레포에는 **내가 만든 시스템(코드·설계문서)** 만 있습니다.
> 그 시스템이 다루는 **데이터(KEI 규정 볼트·원본 HWP·벡터DB)는 내부 전용**이며 공개 레포에 두지 않습니다.
> 데이터 분리는 `.gitignore` + 공유 pre-commit 훅 + CI + 전 히스토리 purge로 강제하고, 볼트는 git이 아니라 **Syncthing(내부 전용)** 으로만 동기화합니다.

---

## 1. 데이터 분류

| 자산 | 분류 | 저장 위치 | 공개 여부 |
|---|---|---|---|
| 파이프라인 코드 (`tools/`) | 공개 | git | ✅ 공개 |
| 설계·계획 문서 (`docs/`, `README`, `WORKPLAN`, `CLAUDE`) | 공개 | git | ✅ 공개 |
| 배포 설정 (`deploy/`) | 공개(설정만, 시크릿 제외) | git | ✅ 공개 |
| 합성 예시 볼트 (`vault-example/`) | 공개 — **가짜 데이터** | git | ✅ 공개 |
| **규정 볼트 (`KEI-행정가이드/`, 변환된 규정 원문)** | **내부 전용** | 디스크 + Syncthing | ⛔ 비공개 |
| **원본 HWP (`rule_files/`)** | **내부 전용** | 디스크 + Syncthing | ⛔ 비공개 (git에 커밋된 적 없음) |
| 벡터DB (`tools/chroma/`) | 내부 전용 · 파생물 | 디스크 | ⛔ 비공개 (재생성 가능) |
| 모델·임베딩 가중치 | 온프레미스 | 사내 GPU(Quadro RTX 6000) | ⛔ 비공개 |
| 시크릿(`.env`, 키) | 비밀 | 로컬/시크릿 매니저 | ⛔ 비공개 |

---

## 2. 무엇을, 왜 제외하는가

규정 볼트(`KEI-행정가이드/20_규정원문/`)는 **KEI 내부 규정을 변환한 원문**입니다. 외부에 공개되면 내부 규정이 그대로 유출됩니다. 반면 변환·청킹·RAG **코드와 설계 문서**는 공개해도 위험이 없고, 포트폴리오로서 가치가 있습니다.

> 전략 한 줄: **공개 = 시스템(어떻게 만들었는가) / 비공개 = 데이터(무엇을 다루는가).**

`vault-example/`는 "구조는 보여주되 실데이터는 없음"을 위한 **합성 예시**입니다(가짜 규정·가이드·용어 + 템플릿, 실번호 아닌 `9900`).

---

## 3. 위협 모델 (Threat Model)

- **보호 자산:** KEI 내부 규정 원문(`20_규정원문/`).
- **주요 위협:** 내부 규정이 **공개 git 히스토리**에 남아 외부에서 클론·검색·캐시됨. `.gitignore` 추가만으로는 **과거 커밋에서 사라지지 않음**.
- **신뢰 경계:** 공개 GitHub(신뢰하지 않음) ↔ 사내 온프레미스(Cloudflare Zero Trust 뒤). 모델·임베딩이 온프레미스라 추론 데이터가 망 밖으로 나가지 않음.
- **부차 위협:** 코드·설정에 시크릿(키/토큰) 혼입 → gitleaks로 차단.

---

## 4. 통제 (Controls)

| 단계 | 통제 | 위치 |
|---|---|---|
| **예방** | `.gitignore`로 볼트·HWP·`*.hwp/hwpx` 차단 | `.gitignore` |
| **예방** | 공유 pre-commit 훅 — 내부 콘텐츠 스테이징 시 커밋 차단 | `.githooks/pre-commit` (활성화: `git config core.hooksPath .githooks`) |
| **예방** | 공개본은 합성 예시만 | `vault-example/` |
| **탐지** | CI — `git ls-files`로 내부 콘텐츠 존재 검사 + gitleaks 시크릿 스캔 | `.github/workflows/security-scan.yml` |
| **탐지** | (선택) pre-commit 프레임워크 gitleaks 훅 | `.pre-commit-config.yaml` |
| **교정** | `git-filter-repo`로 전 히스토리에서 볼트·HWP 제거 후 force-push | (유지관리자 실행) |
| **서빙 보안** | 두 화면([뇌] Quartz / [LLM] Open WebUI) 모두 Cloudflare Zero Trust Access 뒤 + Open WebUI RBAC/SSO | `docs/07-security-governance.md` |
| **데이터 비유출** | 모델·임베딩 온프레미스(사내 GPU) → 추론 데이터 망 밖 유출 없음 | `docs/adr/0005-on-prem-zero-trust.md` |
| **비공개 동기화** | 볼트는 git이 아니라 Syncthing(내부 전용, GUI는 로컬 바인딩)으로 서버↔PC 동기화 | `deploy/syncthing-compose.yml` |

---

## 5. 사고 및 교정 이력 (Incident & Remediation)

**2026-06-19 — 공개 레포 히스토리에 내부 볼트 노출 확인 및 교정**

1. **탐지(Detect).** 공개 레포 초기 커밋(`9a38696`)부터 **5개 커밋**에 걸쳐 변환된 규정 원문(볼트 127개 파일)이 포함돼 있음을 확인. (원본 HWP `*.hwp/hwpx`는 히스토리에 **한 번도** 커밋된 적 없음.)
2. **격리(Contain).** `.gitignore`에 `KEI-행정가이드/`·`rule_files/`·`*.hwp/hwpx` 추가, `git rm -r --cached`로 인덱스 추적 중단. **디스크의 볼트 파일은 보존**(서버의 진실원천).
3. **예방(Prevent).** 공유 pre-commit 훅 + GitHub Actions CI(내부 콘텐츠·시크릿 검사) 도입.
4. **제거(Eradicate).** `git-filter-repo`로 전 히스토리에서 볼트·HWP 경로를 제거하고 `--force` push로 공개 이력 재작성.
5. **잔여 위험(Residual).** 노출 기간 동안 외부 클론/포크/검색엔진 캐시 가능성은 git 조치만으로 완전히 회수되지 않음 → KEI 정책에 따라 처리(필요 시 레포 삭제·재생성). 아래 연락처 참조.

> 처리 순서: **탐지 → 격리 → 예방 → 제거.** **2026-06-19 전 단계 완료** — `git-filter-repo`로 전 히스토리에서 `KEI-행정가이드/`를 제거(12→11 커밋, 볼트 객체 212→0)하고 `force-push`로 공개 이력을 재작성(승인된 파괴적 작업, 백업 bundle 2종 보유). 작업트리의 볼트·HWP(127·112 파일)는 보존. 노출 기간의 외부 클론/캐시 잔여 위험은 위 5번 항목 참조.

---

## 6. 취약점 신고 / 문의

내부 규정 노출 등 보안 사안은 **공개 이슈로 올리지 말고** 아래로 비공개 제보해 주세요.

- 담당: 〔TODO: 담당자/팀 채워넣기〕
- 이메일: 〔TODO: 보안 연락 이메일〕

---

## 관련 문서
- 거버넌스(접근통제·검수·감사): [docs/07-security-governance.md](docs/07-security-governance.md)
- 온프레미스·Zero Trust 결정 근거: [docs/adr/0005-on-prem-zero-trust.md](docs/adr/0005-on-prem-zero-trust.md)
- 공개용 데이터 분리 예시: [vault-example/](vault-example/)

> 최종 수정: 2026-06-19
