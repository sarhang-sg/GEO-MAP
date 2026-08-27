
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.navkurd.app",
  appName: "NAV KURD",
  webDir: "dist",
  loggingBehavior: "none",
  backgroundColor: "#090d19",
  appendUserAgent: " NAV-KURD-Native/8.0.4",
  zoomEnabled: false,
  ios: { scheme: "App", contentInset: "never", scrollEnabled: false, backgroundColor: "#090d19", zoomEnabled: false },
  android: { backgroundColor: "#090d19", allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  server: { hostname: "localhost", androidScheme: "https", iosScheme: "capacitor", errorPath: "native-error.html" },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: "#090d19", showSpinner: false, iosSpinnerStyle: "small", spinnerColor: "#8d35aa" },
    StatusBar: { overlaysWebView: true, style: "LIGHT" }
  }
};
export default config;
