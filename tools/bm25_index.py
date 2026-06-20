#!/usr/bin/env python3
"""bm25_index.py — 순수 파이썬 BM25(Okapi) + RRF 융합. 무설치(외부 의존 0).

하이브리드 검색용 어휘(lexical) 검색기. 밀집(dense, KURE-v1) 검색을 보완한다:
규정명·별표 번호·정확한 용어처럼 '글자 그대로' 매칭이 중요한 질의에서 강함.

한국어 토크나이저: 단어 토큰 + 한글 음절 2-gram(형태소기 없이도 부분일치 회수).
RRF(Reciprocal Rank Fusion): score(d) = Σ_r 1/(k + rank_r(d)). 점수 스케일이 다른
밀집/어휘 랭킹을 순위만으로 안전하게 합친다(정규화 불필요).

⛔ 외부 API/다운로드 없음. CPU만 사용.
"""
import math
import re
from collections import Counter, defaultdict

_WORD = re.compile(r"[a-z0-9]+|[가-힣]+")


def tokenize(text: str):
    """소문자 단어/숫자 + 한글은 음절 2-gram(3음절 이상)으로 분해 + 원형 토큰."""
    out = []
    for t in _WORD.findall((text or "").lower()):
        if t[0] >= "가":  # 한글
            if len(t) <= 2:
                out.append(t)
            else:
                out.extend(t[i:i + 2] for i in range(len(t) - 1))
                out.append(t)
        else:
            out.append(t)
    return out


class BM25:
    """Okapi BM25. 코퍼스는 (id, text) 리스트로 한 번 구축."""

    def __init__(self, ids, texts, k1: float = 1.5, b: float = 0.75):
        self.ids = ids
        self.k1, self.b = k1, b
        self.docs = [tokenize(t) for t in texts]
        self.N = len(self.docs)
        self.dl = [len(d) for d in self.docs]
        self.avgdl = (sum(self.dl) / self.N) if self.N else 0.0
        self.tf = [Counter(d) for d in self.docs]
        df = defaultdict(int)
        for c in self.tf:
            for term in c:
                df[term] += 1
        # idf (BM25+ 양수 보장식)
        self.idf = {t: math.log(1 + (self.N - n + 0.5) / (n + 0.5)) for t, n in df.items()}
        self.postings = defaultdict(list)  # term -> [doc_idx,...]
        for i, c in enumerate(self.tf):
            for term in c:
                self.postings[term].append(i)

    def search(self, query: str, n: int = 20):
        """질의 → [(id, score)] 상위 n (점수 내림차순)."""
        q = [t for t in tokenize(query) if t in self.idf]
        if not q:
            return []
        scores = defaultdict(float)
        for term in set(q):
            idf = self.idf[term]
            for i in self.postings[term]:
                f = self.tf[i][term]
                denom = f + self.k1 * (1 - self.b + self.b * self.dl[i] / (self.avgdl or 1))
                scores[i] += idf * (f * (self.k1 + 1)) / (denom or 1)
        ranked = sorted(scores.items(), key=lambda x: -x[1])[:n]
        return [(self.ids[i], s) for i, s in ranked]


def rrf(rankings, k: int = 60, top: int = 5, weights=None):
    """여러 랭킹(list of [id,...] 또는 [(id,score),...])을 (가중) RRF로 융합 → 상위 top.

    rankings: 각 원소는 순위 정렬된 id(또는 (id,score)) 시퀀스.
    weights: 랭커별 가중치(없으면 모두 1). 강한 밀집 검색을 약한 어휘 검색이
             끌어내리지 않도록 밀집에 더 큰 가중을 줄 수 있다(예: [2,1]).
    반환: [(id, rrf_score)] 상위 top.
    """
    w = weights or [1.0] * len(rankings)
    agg = defaultdict(float)
    for wi, ranking in zip(w, rankings):
        for rank, item in enumerate(ranking, 1):
            doc_id = item[0] if isinstance(item, (tuple, list)) else item
            agg[doc_id] += wi / (k + rank)
    return sorted(agg.items(), key=lambda x: -x[1])[:top]
