#!/usr/bin/env bash
# 우분투 서버용 HWP/HWPX 변환 툴체인 (headless, GUI 불필요)
set -e

echo "[1/3] 순수 파이썬 파서 (주 경로: .hwp + .hwpx 모두 처리)"
pip install --upgrade hwp-hwpx-parser

echo "[2/3] LibreOffice + H2Orestart (fallback: 표/별표 깨질 때 PDF로)"
sudo apt-get update
sudo apt-get install -y libreoffice unzip wget
# H2Orestart 확장 (한컴파일 읽기) — 최신 릴리스로 교체 가능
H2O_URL="https://github.com/ebandal/H2Orestart/releases/latest/download/H2Orestart.oxt"
wget -O /tmp/H2Orestart.oxt "$H2O_URL" || echo "최신 릴리스 URL은 github.com/ebandal/H2Orestart/releases 에서 확인"
unopkg add --shared /tmp/H2Orestart.oxt || unopkg add /tmp/H2Orestart.oxt

echo "[3/3] 변환 테스트 예시"
echo '  # 단일 파일을 PDF로 (headless):'
echo '  soffice --headless --convert-to pdf:writer_pdf_Export 파일.hwp'
echo '  # 폴더 일괄 PDF:'
echo '  soffice --headless --convert-to pdf --outdir ./pdf ./hwp/*.hwp ./hwp/*.hwpx'
echo "완료. 표가 많은 별표는 만들어진 PDF 페이지를 VLM(Qwen2.5-VL)에 넘겨 마크다운 표로 추출하세요."
