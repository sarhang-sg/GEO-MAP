import UIKit
import Capacitor

public class NavKurdBridgeViewController: CAPBridgeViewController {
    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 9.0 / 255.0, green: 13.0 / 255.0, blue: 25.0 / 255.0, alpha: 1.0)
        bridge?.webView?.backgroundColor = view.backgroundColor
        bridge?.webView?.isOpaque = false
        bridge?.webView?.scrollView.backgroundColor = view.backgroundColor
        bridge?.webView?.scrollView.bounces = false
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    public override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NavKurdNativePlugin())
    }
}
