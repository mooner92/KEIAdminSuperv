import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";

// KEI 행정 가이드 모바일 앱(docs/54 v2, Expo 1단계 PoC).
// 전략: 이미 반응형+모바일 셸이 완성된 웹앱을 WebView로 감싼다 → 즉시 앱화.
// 2단계(추후): lib/ 공용 로직 재사용 + 화면별 컴포넌트를 React Native로 이식.
// ⚠ URL은 app.json > expo.extra.appUrl(사내 전용, Cloudflare Zero Trust 뒤)에서 주입 — 하드코딩 금지.
const APP_URL: string =
  (Constants.expoConfig?.extra?.appUrl as string) || "https://example.invalid";

export default function App() {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Android 하드웨어 뒤로가기 → WebView 히스토리 우선(앱 종료 대신 화면 뒤로).
  useFocusBackHandler(canGoBack, () => webRef.current?.goBack());

  const onNav = useCallback((s: WebViewNavigation) => setCanGoBack(s.canGoBack), []);
  const reload = useCallback(() => {
    setError(false); setLoading(true); webRef.current?.reload();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        {error ? (
          // 오프라인·사내망 밖: 재시도 안내(Cloudflare ZT 접근 실패 등).
          <ScrollView
            contentContainerStyle={styles.center}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          >
            <Text style={styles.errTitle}>연결할 수 없어요</Text>
            <Text style={styles.errBody}>
              사내망(또는 Cloudflare Zero Trust) 연결을 확인하고 다시 시도하세요.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={reload}>
              <Text style={styles.btnText}>다시 시도</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <WebView
            ref={webRef}
            source={{ uri: APP_URL }}
            onNavigationStateChange={onNav}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setError(true); setLoading(false); }}
            onHttpError={() => setLoading(false)}
            // 웹앱이 이미 하단 탭바·safe-area를 그리므로 WebView는 전체를 채운다.
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            decelerationRate="normal"
            style={styles.web}
          />
        )}
        {loading && !error ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" />
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Android 뒤로가기 훅 — canGoBack이면 WebView를 뒤로, 아니면 기본(앱 종료) 동작.
function useFocusBackHandler(canGoBack: boolean, goBack: () => void) {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) { goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack, goBack]);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  web: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  errTitle: { fontSize: 18, fontWeight: "700", color: "#111" },
  errBody: { fontSize: 14, color: "#555", textAlign: "center", lineHeight: 21 },
  btn: { marginTop: 8, backgroundColor: "#256ef4", paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
