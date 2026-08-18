#!/usr/bin/env python3
"""test_topic_gate.py — 주제 부재 게이트 회귀(docs/71 G1, 2026-08-18 재개).

지키는 계약(전부 08-14 기각·08-18 재개의 실측 근거):
  T1 형태소 추출이 **용언 활용형을 명사로 오인하지 않는다**(08-14 기각의 직접 원인).
  T2 표적 복합명사(명상실·충전소)는 살아남는다 — 어간 휴리스틱 철회 근거의 회귀.
  T3 XSN 접미(들·별·란)는 병합하지 않는다 — '용도구분별' 통짜 부재 판정 재발 방지.
  T4 발동은 **교집합**일 때만: 부재 명사 ∧ (본문 거부 ∧ 결론 단정).
     단독 조건(부재만·불일치만)으로는 절대 발동하지 않는다.
  T5 결론부부터 정직하게 거부한 답변엔 중복 경보를 붙이지 않는다.
  T6 노트 접두가 refusal_detect.NOTE_TITLES에 등록돼 있다(채점 오염 차단 — specs/16 W1-C).
  T7 분석기가 없으면 게이트는 **꺼진다**(정규식 폴백으로 되돌아가지 않는다).

실행: cd tools && .venv/bin/python test_topic_gate.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_core  # noqa: E402
import refusal_detect  # noqa: E402

# 코퍼스 접근(chroma)을 실제로 하지 않도록 고정 코퍼스를 주입한다 — 회귀는 GPU·DB 없이 돈다.
FAKE_CORPUS = ("회의실내로의음식물반입은금지한다열람실용도구분에따라예산을집행하려는경우"
               "승진임용은명상수련회충전전력사용료를납부한다내용별지참석자")


class TopicGateTest(unittest.TestCase):
    def setUp(self):
        rag_core._state["corpus_text"] = FAKE_CORPUS
        rag_core.TOPIC_GATE = True

    # ── 명사 추출 ───────────────────────────────────────────────────────────
    def test_T1_verb_inflection_not_a_noun(self):
        """'집행하려는데'·'며칠인가요'·'거예요'가 명사 후보로 새지 않는다(08-14 오탐 3/11)."""
        nouns = rag_core._topic_nouns("연구과제 예산을 집행하려는데 며칠인가요? 그거예요?")
        if not nouns:
            self.skipTest("kiwipiepy 미설치 — T7이 커버")
        for bad in ("집행하려는데", "며칠인가요", "그거예요", "거예요"):
            self.assertNotIn(bad, nouns, f"용언/어미 어절이 명사로 새어 나왔다: {bad}")
        self.assertIn("집행", nouns, "어간 명사는 살아 있어야 한다")

    def test_T2_compound_target_survives(self):
        """'명상실'·'충전소'는 통째로 후보에 남는다(어간으로 쪼개면 표적이 죽는다)."""
        nouns = rag_core._topic_nouns("명상실 예약과 전기차 충전소 이용은 어떻게 하나요?")
        if not nouns:
            self.skipTest("kiwipiepy 미설치")
        self.assertIn("명상실", nouns)
        self.assertIn("충전소", nouns)

    def test_T3_xsn_suffix_is_a_boundary(self):
        """XSN(별·들·란)은 병합하지 않는다 — '용도구분별' 통짜 부재 오탐 재발 방지."""
        nouns = rag_core._topic_nouns("용도구분별 신청방법과 참석자란 내용들은 무엇인가요?")
        if not nouns:
            self.skipTest("kiwipiepy 미설치")
        self.assertNotIn("용도구분별", nouns)
        self.assertIn("용도구분", nouns)

    # ── 발동 조건(교집합) ──────────────────────────────────────────────────
    def _note(self, q, a, ctx=""):
        return rag_core.topic_absence_note(q, a, ctx)

    def test_T4a_intersection_fires(self):
        """부재 명사 + (본문 거부 ∧ 결론 단정) → 경고."""
        if not rag_core._topic_nouns("명상실"):
            self.skipTest("kiwipiepy 미설치")
        # ⚠ 결론부(첫 문단)는 40자 이상이어야 한다 — refusal_detect._head가 짧은 첫 문단을
        #   본문까지 확장해 읽기 때문(그 경우 '정직한 거부'로 보고 T5 경로로 빠진다).
        a = ("**명상실 예약은 연구원 통합정보시스템을 통해 신청하시면 처리됩니다.**\n\n"
             "다만 명상실이 휴양시설에 해당하는지는 규정에서 확인되지 않습니다.")
        self.assertIn("근거 밖 주제", self._note("명상실 예약은 어떻게 하나요?", a))

    def test_T4b_absence_alone_does_not_fire(self):
        """본문에 주저가 전혀 없으면(완전 단정) 발동하지 않는다 — 정밀도 17%짜리 단독 조건 금지."""
        if not rag_core._topic_nouns("명상실"):
            self.skipTest("kiwipiepy 미설치")
        a = "**명상실 예약은 통합정보시스템으로 신청하면 됩니다.** 담당은 총무팀입니다."
        self.assertEqual("", self._note("명상실 예약은 어떻게 하나요?", a))

    def test_T4c_mismatch_alone_does_not_fire(self):
        """질문 명사가 전부 코퍼스에 있으면(어휘 갭 아님) 결론불일치만으로 발동하지 않는다."""
        a = ("**회의실 내 음식물 반입은 금지됩니다.**\n\n"
             "다만 일반 회의실 여부는 규정에서 확인되지 않습니다.")
        self.assertEqual("", self._note("회의실 음식물 반입이 금지인가요?", a))

    def test_T5_honest_refusal_not_double_warned(self):
        """결론부터 거부한 답변엔 중복 경보를 붙이지 않는다."""
        a = "**명상실 예약 절차는 규정에서 확인되지 않습니다.** 담당 부서 확인이 필요합니다."
        self.assertEqual("", self._note("명상실 예약은 어떻게 하나요?", a))

    def test_T5b_context_presence_suppresses(self):
        """회수 근거에 그 낱말이 있으면 '부재'가 아니다 — 근거 있는 답변을 때리지 않는다."""
        a = ("**명상실은 3층입니다.**\n\n세부 운영시간은 규정에서 확인되지 않습니다.")
        self.assertEqual("", self._note("명상실 위치가 어디인가요?", a,
                                        "명상실 운영 안내 — 명상실은 3층에 있다"))

    def test_T6_note_title_registered(self):
        """노트 접두가 채점기 제거 목록에 있어야 한다 — 없으면 정상 답변이 '거부'로 오채점된다."""
        self.assertIn("⚠️ **근거 밖 주제**", refusal_detect.NOTE_TITLES)
        if not rag_core._topic_nouns("명상실"):
            return
        a = ("**명상실 예약은 연구원 통합정보시스템을 통해 신청하시면 처리됩니다.**\n\n"
             "다만 세부 절차는 근거에서 확인되지 않습니다.")
        note = self._note("명상실 예약은 어떻게 하나요?", a)
        self.assertTrue(note)
        self.assertFalse(refusal_detect.is_refusal(a + "\n\n" + note),
                         "노트가 붙었다고 답변이 '거부'로 판정되면 자가평가가 오염된다")

    def test_T7_gate_off_without_analyzer(self):
        """분석기 부재 = 게이트 off(구 정규식 폴백 금지)."""
        saved = rag_core._state.get("kiwi")
        rag_core._state["kiwi"] = None
        try:
            self.assertEqual([], rag_core._topic_nouns("명상실 예약"))
            a = ("**명상실 예약은 통합정보시스템으로 신청하면 됩니다.**\n\n"
                 "다만 규정에서 확인되지 않습니다.")
            self.assertEqual("", self._note("명상실 예약은 어떻게 하나요?", a))
        finally:
            rag_core._state["kiwi"] = saved

    def test_T8_gate_disabled_by_env_flag(self):
        rag_core.TOPIC_GATE = False
        a = ("**명상실 예약은 신청하면 됩니다.**\n\n규정에서 확인되지 않습니다.")
        self.assertEqual("", self._note("명상실 예약은 어떻게 하나요?", a))


if __name__ == "__main__":
    unittest.main(verbosity=2)
