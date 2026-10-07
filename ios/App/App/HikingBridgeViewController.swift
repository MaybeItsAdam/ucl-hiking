import Capacitor
import UIKit

/// Main.storyboard's root view controller. Exists to register the app's own
/// (local) Capacitor plugins, which npm-installed plugins don't need.
class HikingBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NfcTagPlugin())
    }
}
