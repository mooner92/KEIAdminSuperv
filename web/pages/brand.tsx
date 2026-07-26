import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import HorongMark from "../components/common/HorongMark";
import { useFlag } from "../lib/flags";
import { SITE_NAME } from "../lib/site";
import s from "../styles/Brand.module.css";

// 브랜드·디자인 이야기(flag brand_page) — 푸터 구석 진입. 사용자 지시(2026-07-27):
// "FAQ 같은 곳 어디 구석에 디자인 원칙·호롱 의미를 정리해 보여주는 페이지".
// ⛔ 여기는 사용자 언어다 — 파일 경로·토큰 변수명·내부 구현 용어를 쓰지 않는다.
//    개발자용 정본은 docs/design-system.md(원칙 P1~P10) · 원본 자산은 design/horong/.
// 이 페이지 자체가 원칙의 예시가 되도록: 선 대신 여백·톤, 그라데이션은 심볼과 히어로 워드에만.

/** 심볼이 겹쳐 담은 세 가지 */
const MEANINGS = [
  { emoji: "💧", title: "물방울", body: "규정이라는 큰 흐름에서 지금 내게 필요한 한 방울만 떠서 건넵니다. 전문을 다 읽지 않아도 되도록." },
  { emoji: "🌿", title: "잎", body: "처음 온 사람도 자라납니다. 신입·전입자가 스스로 답을 찾아가는 과정을 곁에서 돕는다는 뜻이에요." },
  { emoji: "🔥", title: "호롱불", body: "밝히되 눈부시지 않게. 답을 대신 정해주지 않고, 근거가 있는 곳까지만 비춥니다." },
];

/** 팔레트 — 값은 화면에 실제로 쓰이는 색 */
const PALETTE = [
  { name: "불빛(엠버)", hex: "#e06a12", note: "버튼·링크 등 사용자가 누르는 것" },
  { name: "잎", hex: "#35906a", note: "확인된 것 · 검수완료" },
  { name: "앰버", hex: "#e9a13b", note: "확인이 필요한 것 · 미검수" },
  { name: "잉크", hex: "#1d1f1d", note: "본문 글자" },
  { name: "웜 화이트", hex: "#fafaf7", note: "페이지 바탕 — 순백보다 눈이 편해요" },
];

const SECTIONS = [
  { name: "규정집", hex: "#4f8dc4" }, { name: "가이드", hex: "#35906a" },
  { name: "용어집", hex: "#e9a13b" }, { name: "사내 시스템", hex: "#8d7ac9" },
  { name: "대외업무", hex: "#cf6d96" }, { name: "상위 법령", hex: "#7f8a94" },
];

/** 사용자가 화면에서 체감하는 형태로 옮긴 원칙 */
const PRINCIPLES = [
  { n: "01", title: "선 대신 여백으로 나눕니다",
    body: "칸을 진한 테두리로 가르지 않아요. 여백과 아주 옅은 톤 차이로 구역을 나눠서, 화면이 빽빽해 보이지 않게 합니다." },
  { n: "02", title: "그라데이션은 아껴 씁니다",
    body: "여러 색이 섞인 그라데이션은 로고와 첫 문장처럼 브랜드를 드러내는 자리에만 씁니다. 본문 곳곳에 쓰면 정작 중요한 곳이 묻히니까요." },
  { n: "03", title: "색만으로 알리지 않습니다",
    body: "검수완료·미검수 같은 상태는 색과 함께 항상 글자를 같이 보여줍니다. 색을 구분하기 어려운 분도 같은 정보를 얻어야 하니까요." },
  { n: "04", title: "읽기 쉬움이 먼저입니다",
    body: "표에 빽빽하게 밀어넣기보다 한 줄에 하나씩. 규정처럼 긴 글을 읽는 화면이라 글자 크기와 줄 간격을 넉넉히 잡았습니다." },
  { n: "05", title: "어두운 화면도 같이 만듭니다",
    body: "밝은 화면에서 만든 색을 그대로 뒤집지 않고, 어두운 화면용 색을 따로 골랐습니다. 기본값은 컴퓨터 설정을 따라가요." },
  { n: "06", title: "밖으로 나가지 않습니다",
    body: "글꼴·아이콘까지 전부 원내 서버에 두고 씁니다. 외부 서비스를 부르지 않으니 규정 내용이 밖으로 새어 나갈 길이 없습니다." },
];

export default function BrandPage() {
  const on = useFlag("brand_page");
  return (
    <Layout>
      <Head>
        <title>{`브랜드 이야기 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {!on ? (
        <PageHero title="브랜드 이야기" lead="이 페이지는 아직 준비 중이에요. 곧 만나요!" />
      ) : (
        <div className={s.wrap}>
          {/* 히어로 — 그라데이션은 여기 워드 하나에만(원칙 02) */}
          <section className={s.hero}>
            <HorongMark size={72} />
            <h1 className={s.heroTitle}>
              어두운 규정집을 <span className={s.grad}>호롱불</span>처럼
            </h1>
            <p className={s.heroLead}>
              호롱은 등잔에 불을 밝히던 옛 등불입니다. 방 전체를 환하게 비추진 못해도,
              지금 손에 든 것을 읽기에는 충분하죠. 이 서비스가 하려는 일도 같습니다 —
              규정 전체를 외우게 하는 대신, 지금 하려는 업무에 필요한 조문만 비춥니다.
            </p>
          </section>

          <section className={s.block}>
            <h2 className={s.h2}>심볼에 담은 세 가지</h2>
            <p className={s.sub}>하나의 실루엣이 물방울이면서 잎이고 불꽃입니다.</p>
            <div className={s.cards}>
              {MEANINGS.map((m) => (
                <div key={m.title} className={s.card}>
                  <span className={s.cardIcon} aria-hidden>{m.emoji}</span>
                  <b className={s.cardTitle}>{m.title}</b>
                  <p className={s.cardBody}>{m.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={s.block}>
            <h2 className={s.h2}>색</h2>
            <p className={s.sub}>불빛의 따뜻한 계열을 중심으로, 눈이 오래 머물러도 편한 저채도로 골랐습니다.</p>
            <ul className={s.swatches}>
              {PALETTE.map((c) => (
                <li key={c.hex} className={s.swatch}>
                  <span className={s.chip} style={{ background: c.hex }} aria-hidden />
                  <b>{c.name}</b>
                  <code className={s.hex}>{c.hex}</code>
                  <span className={s.note}>{c.note}</span>
                </li>
              ))}
            </ul>
            <p className={s.sub} style={{ marginTop: 18 }}>
              문서의 성격은 여섯 가지 색으로 구분합니다. 색 옆에는 늘 이름을 함께 적어요(원칙 03).
            </p>
            <ul className={s.tags}>
              {SECTIONS.map((c) => (
                <li key={c.name} className={s.tag}>
                  <span className={s.dot} style={{ background: c.hex }} aria-hidden />{c.name}
                </li>
              ))}
            </ul>
          </section>

          <section className={s.block}>
            <h2 className={s.h2}>화면을 만들 때 지키는 것</h2>
            <p className={s.sub}>새 화면을 붙일 때마다 아래 여섯 가지에 비춰 봅니다.</p>
            <ol className={s.principles}>
              {PRINCIPLES.map((p) => (
                <li key={p.n} className={s.principle}>
                  <span className={s.pnum}>{p.n}</span>
                  <div>
                    <b className={s.ptitle}>{p.title}</b>
                    <p className={s.pbody}>{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={s.outro}>
            <p>
              이름과 색은 바뀔 수 있지만, <b>근거 없이는 답하지 않는다</b>는 원칙은 바뀌지 않습니다.
              답변 아래 출처가 늘 붙어 있는 이유예요.
            </p>
            <p className={s.links}>
              <Link href="/help/">사용법이 궁금하다면 → 도움말</Link>
              <Link href="/about/">서비스가 궁금하다면 → 소개</Link>
            </p>
          </section>
        </div>
      )}
    </Layout>
  );
}
