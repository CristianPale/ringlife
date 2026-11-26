import UIKit
import Capacitor

/// Il controller dell'app: registra i plugin locali (docs/adr/0026).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RingBackgroundPlugin())
    }
}
