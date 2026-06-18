# tools/ — HWP → 볼트 적재 → 로컬 RAG

Sean의 GPU 서버(A40)에서 돌리는 3단계 파이프라인.
이 스크립트들은 **출발점 스켈레톤**이라 실제 HWP 파일/모델로 한 번씩 검증하면서 다듬으세요.

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

## HWP 변환이 깨질 때 (표·별표·서식)
순수 파이썬 파서가 표/별표에서 깨지면 LibreOffice + H2Orestart 로 PDF를 만들고,
그 페이지를 VLM(Qwen2.5-VL / Gemma)에 넘겨 표만 다시 마크다운으로 뽑는 게 가장 깔끔합니다.

```bash
# Ubuntu: H2Orestart 확장 설치 후
soffice --headless --convert-to pdf:writer_pdf_Export 4300여비규정.hwp
# → 4300여비규정.pdf 의 표 페이지를 VLM에 "이 표를 마크다운으로" 프롬프트
```
