# tools/ — HWP → 볼트 적재 → 로컬 RAG

사내 GPU 서버(2×Quadro RTX 6000 24GB, 공유·변동적)에서 돌리는 변환→적재→색인→RAG 파이프라인.
아래는 핵심 3단계 요약이며, 전체 스크립트(01b~01u·04 RAG API)와 실행 커맨드의 진실원천은 루트 `CLAUDE.md`의 '실행 커맨드' 절이다.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) HWP들을 마크다운으로 (볼트의 20_규정원문/ 아래로)
python 01_hwp_to_md.py --src /path/to/규정_hwp_폴더 --vault ../KEI-행정가이드

# 2) 제N조 단위 청킹 + 한국어 임베딩 + Chroma 적재
python 02_chunk_and_embed.py --vault ../KEI-행정가이드 --db ./chroma

# 3) 질의 (검색 → 근거 조문 → 로컬 LLM → 출처 표기)
python 03_rag_query.py --db ./chroma --q "법인카드로 주말에 비품 사도 되나요?"
```

## 자주 쓰는 후속 파이프라인 (전체 목록은 루트 CLAUDE.md '실행 커맨드')
```bash
# 용어집 확충 — 규정 정의 조항 원문 인용(ALLOWLIST 사람 큐레이션, 88→119 용어, docs/49)
python 01h_defs_to_terms.py --vault ../KEI-행정가이드 [--dry]
# 별지(서식) 분리 — HWP→ODT(한글서체→나눔 치환+줄간격 ×0.87 보정)→PDF → 별지별 분리 PDF(web/public/forms-pdf/)+PNG+원본 HWP 사본+manifest (docs/50)
python 01p_byeolji_pdf.py [--only <stem>] [--force]
# 별지 감사 — 볼트 MD 별지 블록 A(빈)/B(구조 소실)/C(표 깨짐)/D(빈약) 분류 + manifest 페이지 대조·md 누락 diff → byeolji_audit.json (⛔리포트만, 자동 수정 없음)
python 01q_byeolji_audit.py
```
- 01p 산출물(`web/public/forms-pdf/`·`byeolji_png/`·`.byeolji_cache/`)은 내부 규정 콘텐츠라 전부 gitignore. 재색인 훅(`/app/corpus/reindex`)이 02 전에 01p를 증분 실행하고, `web/server.js`가 `/forms-pdf/*`를 로그인 게이트 뒤에서 직결 서빙한다.
- 01p 필수 의존: LibreOffice+H2Orestart(`unopkg add --shared` 공유 설치 필수)·Java(JRE)·나눔 폰트(`fonts-nanum`) — `deploy/setup_ubuntu_hwp.sh` 및 `docs/50-별지-정확도-다운로드.md` §1 참조.

## HWP 변환이 깨질 때 (표·별표·서식)
순수 파이썬 파서가 표/별표에서 깨지면 LibreOffice + H2Orestart 로 PDF를 만들고,
그 페이지를 VLM(Qwen2.5-VL / Gemma)에 넘겨 표만 다시 마크다운으로 뽑는 게 가장 깔끔합니다.

```bash
# Ubuntu: H2Orestart 확장 설치 후
soffice --headless --convert-to pdf:writer_pdf_Export 4300여비규정.hwp
# → 4300여비규정.pdf 의 표 페이지를 VLM에 "이 표를 마크다운으로" 프롬프트
```

> 별지(서식) 페이지는 `01p_byeolji_pdf.py`가 이 경로를 자동화한다 — 단, HWP→PDF 직행이 아니라 **HWP→ODT→PDF 2단**으로 가서 ODT의 한글 서체를 나눔명조/나눔고딕으로 치환하고 줄간격을 보정한다(HWP 전용 서체 부재 시 LO가 Noto CJK로 폴백해 페이지가 부풀기 때문. fontconfig 매핑은 LO가 무시하므로 ODT 직접 치환만 유효 — docs/50 §8). `fonts-nanum` 설치 필수.
