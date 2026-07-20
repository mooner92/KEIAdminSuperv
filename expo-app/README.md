# KEI 행정 가이드 — 모바일 앱 (Expo 1단계 PoC)

> docs/54 v2 "모바일 전용 셸"의 **Expo 이관 1단계** 스캐폴드. 이미 반응형+모바일 셸이 완성된
> 웹앱(`web/`)을 **WebView로 감싸 즉시 앱화**한다. 실행·설치 없이 구조만 먼저 잡아둔 상태다.

## 무엇인가 (그리고 무엇이 아닌가)
- **1단계(이 스캐폴드)**: 웹앱 URL을 `react-native-webview`로 로드하는 얇은 네이티브 껍데기.
  하단 탭바·safe-area·라우팅은 **웹앱이 이미 처리**(docs/54 v2, `mobile_shell` 플래그 on)하므로
  앱은 로딩·오류·Android 뒤로가기·pull-to-refresh만 담당.
- **2단계(추후)**: `web/lib/`의 공용 로직을 재사용하고, 화면별 컴포넌트(채팅·규정·더보기)를
  React Native 네이티브로 점진 이식. 탭 정의는 이미 데이터(`web/components/mobile/MobileTabBar` →
  `MOBILE_TABS`)로 분리돼 있어 React Navigation 탭에 1:1 매핑 가능.

## 사전 준비
- 웹앱이 사내에서 서빙 중이어야 함(PM2 `kei-guide`, 또는 nginx+Cloudflare ZT).
- 앱은 **사내망/ZT 뒤 URL**에 접근 가능한 기기에서만 동작(내부 전용 — 절대 규칙 5).

## 실행
```bash
cd expo-app
npm install
# 사내 URL 주입: app.json > expo.extra.appUrl 값을 실제 내부 주소로 교체(레포엔 placeholder)
npx expo start          # QR → Expo Go, 또는
npx expo run:android    # 네이티브 빌드(개발 클라이언트)
```

## 구성
| 파일 | 역할 |
|---|---|
| `App.tsx` | WebView 껍데기 — 로딩 인디케이터, 오류/재시도, Android 하드웨어 뒤로가기(WebView 히스토리 우선), pull-to-refresh, safe-area |
| `app.json` | Expo 설정 — 이름·번들ID·스킴. **URL은 `extra.appUrl`**(placeholder, 배포 시 주입) |
| `package.json` | expo 51 · react-native-webview · safe-area-context |

## 보안 메모
- `app.json`의 `extra.appUrl`은 **placeholder**(`REPLACE-WITH-INTERNAL-KEI-URL`)로 커밋한다.
  실제 사내 호스트는 커밋 금지 — 빌드 파이프라인/로컬에서 주입([[data-separation-security]] 원칙).
- 앱은 정적 URL만 로드하며 자격증명·토큰을 저장하지 않는다(인증은 웹앱 쿠키/ZT가 담당).

## 관련
- `docs/54-모바일-우선.md` — 모바일 셸 설계·Expo 이관 시나리오
- `web/components/mobile/` — 하단 탭바·간소 뷰(2단계 이식 대상)
