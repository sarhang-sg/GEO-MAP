import UIKit
import WebKit
import Capacitor

@objc(NavKurdNativePlugin)
public class NavKurdNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NavKurdNativePlugin"
    public let jsName = "NavKurdNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "cacheStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearTransientCache", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showError", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "safeAreaInsets", returnType: CAPPluginReturnPromise)
    ]

    @objc func cacheStatus(_ call: CAPPluginCall) {
        let cache = URLCache.shared
        call.resolve([
            "memoryBytes": cache.currentMemoryUsage,
            "diskBytes": cache.currentDiskUsage
        ])
    }

    @objc func clearTransientCache(_ call: CAPPluginCall) {
        URLCache.shared.removeAllCachedResponses()
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache
        ]
        WKWebsiteDataStore.default().removeData(
            ofTypes: cacheTypes,
            modifiedSince: Date(timeIntervalSince1970: 0)
        ) {
            call.resolve(["cleared": true])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let settingsURL = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(settingsURL) else {
                call.reject("iOS Settings is unavailable.")
                return
            }
            UIApplication.shared.open(settingsURL, options: [:]) { opened in
                if opened { call.resolve() }
                else { call.reject("Could not open iOS Settings.") }
            }
        }
    }

    @objc func showError(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "NAV KURD"
        let message = call.getString("message") ?? "The map could not be opened."
        let retryLabel = call.getString("retryLabel") ?? "Retry"
        let settingsLabel = call.getString("settingsLabel") ?? "Settings"
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.reject("Native view controller is unavailable.")
                return
            }
            if controller.presentedViewController is UIAlertController {
                call.resolve()
                return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: retryLabel, style: .default) { _ in
                self.bridge?.webView?.reload()
            })
            alert.addAction(UIAlertAction(title: settingsLabel, style: .cancel) { _ in
                guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(settingsURL)
            })
            controller.present(alert, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func safeAreaInsets(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let insets = self.bridge?.viewController?.view.safeAreaInsets ?? .zero
            call.resolve([
                "top": insets.top,
                "right": insets.right,
                "bottom": insets.bottom,
                "left": insets.left
            ])
        }
    }
}
