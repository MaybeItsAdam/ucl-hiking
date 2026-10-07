import Capacitor
import CoreNFC
import Foundation

/**
 * Reads the factory UID of the NTAG213 stickers on club kit.
 *
 * Why this is a local plugin rather than @capgo/capacitor-nfc on iOS: the
 * Capacitor 7 line of that plugin (7.2.0) only opens an NFCNDEFReaderSession,
 * which does not expose a tag's UID and gives up on a blank tag (an empty NDEF
 * message is an error there). An NFCTagReaderSession sees any ISO 14443 tag,
 * formatted or not, and hands over its identifier. Android uses the capgo
 * plugin, whose reader mode already does the right thing.
 *
 * JS name "HikingNfc" (see src/lib/nfc.ts):
 *   isAvailable() -> { available }
 *   startScanning({ alertMessage, continuous }) resolves once the session begins
 *   stopScanning()
 *   events: "tag" { uid: [bytes] }, "sessionEnded" { reason, message? }
 *     reason: "stopped" | "done" | "cancelled" | "timeout" | "error"
 */
@objc(NfcTagPlugin)
public class NfcTagPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate {
    public let identifier = "NfcTagPlugin"
    public let jsName = "HikingNfc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScanning", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCTagReaderSession?
    private var continuous = false
    private var alertMessage = ""
    /// Set when we end the session ourselves, so the "user cancelled" error
    /// CoreNFC reports for any invalidate() isn't passed on as one.
    private var endReason: String?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": NFCTagReaderSession.readingAvailable])
    }

    @objc func startScanning(_ call: CAPPluginCall) {
        guard NFCTagReaderSession.readingAvailable else {
            call.reject("This phone can't read NFC tags.", "NO_NFC")
            return
        }
        let continuous = call.getBool("continuous", false)
        let alertMessage = call.getString("alertMessage", "Hold the top of your phone near the kit tag")

        // All session state lives on the main queue (the delegate's queue too).
        DispatchQueue.main.async {
            self.continuous = continuous
            self.alertMessage = alertMessage
            // Replacing a session: its didInvalidate is ignored (see below).
            self.session?.invalidate()
            self.session = nil
            // ISO 14443 covers NTAG21x (NFC Forum Type 2), which iOS reports
            // as a MIFARE Ultralight-family tag.
            guard let session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil) else {
                call.reject("Couldn't start the NFC reader.", "UNAVAILABLE")
                return
            }
            session.alertMessage = self.alertMessage
            self.endReason = nil
            self.session = session
            session.begin()
            call.resolve()
        }
    }

    @objc func stopScanning(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let session = self.session {
                self.endReason = "stopped"
                session.invalidate()
            }
            call.resolve()
        }
    }

    // MARK: - NFCTagReaderSessionDelegate

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        // queue: nil, so CoreNFC calls back on the main queue.
        // A session we replaced in startScanning ends quietly.
        guard session === self.session else { return }
        self.session = nil
        let ours = endReason
        endReason = nil

        var data: [String: Any] = [:]
        if let ours {
            data["reason"] = ours
        } else if let nfcError = error as? NFCReaderError {
            switch nfcError.code {
            case .readerSessionInvalidationErrorUserCanceled:
                data["reason"] = "cancelled"
            case .readerSessionInvalidationErrorSessionTimeout:
                data["reason"] = "timeout"
            default:
                data["reason"] = "error"
                data["message"] = Self.describe(nfcError)
            }
        } else {
            data["reason"] = "error"
            data["message"] = error.localizedDescription
        }
        notifyListeners("sessionEnded", data: data)
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard tags.count == 1, let tag = tags.first else {
            session.alertMessage = "More than one tag. Hold just one near the phone."
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { session.restartPolling() }
            return
        }

        session.connect(to: tag) { _ in
            // The UID is known from discovery, so a dropped connection doesn't
            // lose it; only an empty identifier counts as a failed read.
            let uid = Self.identifier(of: tag)
            if uid.isEmpty {
                session.alertMessage = "Couldn't read that tag. Hold it still and try again."
                session.restartPolling()
                return
            }

            self.notifyListeners("tag", data: ["uid": uid.map { Int($0) }])

            if self.continuous {
                session.alertMessage = "Got it. " + self.alertMessage
                // A pause first, or the tag still against the phone is read
                // again at once (JS de-bounces it anyway; this saves the churn).
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    if session === self.session { session.restartPolling() }
                }
            } else {
                self.endReason = "done"
                session.alertMessage = "Got it."
                session.invalidate()
            }
        }
    }

    // MARK: - Helpers

    private static func identifier(of tag: NFCTag) -> Data {
        switch tag {
        case .miFare(let t): return t.identifier
        case .iso7816(let t): return t.identifier
        case .iso15693(let t): return t.identifier
        case .feliCa(let t): return t.currentIDm
        @unknown default: return Data()
        }
    }

    private static func describe(_ error: NFCReaderError) -> String {
        switch error.code {
        case .readerErrorUnsupportedFeature:
            return "This phone can't read NFC tags."
        case .readerErrorSecurityViolation, .readerErrorInvalidParameter:
            return "This build of the app isn't allowed to read NFC tags."
        case .readerSessionInvalidationErrorSystemIsBusy:
            return "The phone's NFC reader is busy. Try again in a moment."
        default:
            return error.localizedDescription
        }
    }
}
