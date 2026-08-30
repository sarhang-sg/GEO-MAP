
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.navkurd.app",
  appName: "NAV KURD",
  webDir: "dist",
  loggingBehavior: "none",
  backgroundColor: "#061225",
  appendUserAgent: " NAV-KURD-Native/9.0.0",
  zoomEnabled: false,
  ios: { scheme: "App", contentInset: "never", scrollEnabled: false, backgroundColor: "#061225", zoomEnabled: false },
  android: { backgroundColor: "#061225", allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  server: { hostname: "localhost", androidScheme: "https", iosScheme: "capacitor", errorPath: "native-error.html" },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: "#061225", showSpinner: false, iosSpinnerStyle: "small", spinnerColor: "#55d7ff" },
    StatusBar: { overlaysWebView: true, style: "LIGHT" }
  }
};
export default config;
