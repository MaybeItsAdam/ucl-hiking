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
 *   writeTag({ records, expectedUid?, alertMessage }) -> { uid }
 *     Writes an NDEF message (records: [{ tnf, type: [bytes], id: [bytes],
 *     payload: [bytes] }], built in src/lib/kitTag.ts) on the next tag held
 *     to the phone. With expectedUid ("04:A1:…"), any other tag is passed
 *     over and the sheet asks for the right one. Rejects with code
 *     CANCELLED, TIMEOUT, NOT_NDEF, READ_ONLY, TOO_SMALL or WRITE_FAILED.
 *     Added after 1.0.1: older builds don't list it, and src/lib/nfc.ts
 *     asks them to update.
 *   events: "tag" { uid: [bytes] }, "sessionEnded" { reason, message? }
 *     reason: "stopped" | "done" | "cancelled" | "timeout" | "error"
 *     (scanning sessions only; a write session answers its own call)
 */
@objc(NfcTagPlugin)
public class NfcTagPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate {
    public let identifier = "NfcTagPlugin"
    public let jsName = "HikingNfc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeTag", returnType: CAPPluginReturnPromise)
    ]

    /// A write in progress: its call (answered once), message and the tag it's for.
    private var writeCall: CAPPluginCall?
    private var writeMessage: NFCNDEFMessage?
    private var writeExpectedUid: String?
    /// The current session is a write (set when it begins, so a write that has
    /// already been answered still ends quietly).
    private var isWriteSession = false

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
            // Replacing a session: its didInvalidate is ignored (see below),
            // so a write it was doing is answered here.
            self.answerWrite(error: "Stopped for a scan.", code: "CANCELLED")
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
            self.isWriteSession = false
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

    @objc func writeTag(_ call: CAPPluginCall) {
        guard NFCTagReaderSession.readingAvailable else {
            call.reject("This phone can't write NFC tags.", "NO_NFC")
            return
        }
        guard let message = Self.message(from: call.options["records"]) else {
            call.reject("Nothing to write.", "INVALID")
            return
        }
        let expected = call.getString("expectedUid")?.uppercased()
        let alertMessage = call.getString("alertMessage", "Hold the top of your phone near the kit tag")

        DispatchQueue.main.async {
            self.answerWrite(error: "Stopped for another write.", code: "CANCELLED")
            self.session?.invalidate()
            self.session = nil
            guard let session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil) else {
                call.reject("Couldn't start the NFC reader.", "UNAVAILABLE")
                return
            }
            self.writeCall = call
            self.writeMessage = message
            self.writeExpectedUid = expected
            self.isWriteSession = true
            self.alertMessage = alertMessage
            self.continuous = false
            self.endReason = nil
            session.alertMessage = alertMessage
            self.session = session
            session.begin()
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

        // A write session answers its own call (if the write hasn't already),
        // and says nothing to the scanning listeners.
        if isWriteSession {
            isWriteSession = false
            if let nfcError = error as? NFCReaderError {
                switch nfcError.code {
                case .readerSessionInvalidationErrorUserCanceled:
                    answerWrite(error: "Cancelled.", code: "CANCELLED")
                case .readerSessionInvalidationErrorSessionTimeout:
                    answerWrite(error: "No tag was found in time. Try again.", code: "TIMEOUT")
                default:
                    answerWrite(error: Self.describe(nfcError), code: "WRITE_FAILED")
                }
            } else {
                answerWrite(error: error.localizedDescription, code: "WRITE_FAILED")
            }
            return
        }

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

        if isWriteSession {
            write(to: tag, in: session)
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

    // MARK: - Writing

    private func write(to tag: NFCTag, in session: NFCTagReaderSession) {
        session.connect(to: tag) { error in
            guard session === self.session, let message = self.writeMessage else { return }
            if error != nil {
                self.retry(session, saying: "Lost the tag. Hold it still against the phone.")
                return
            }
            let uid = Self.hex(Self.identifier(of: tag))
            if let expected = self.writeExpectedUid, !expected.isEmpty, expected != uid {
                self.retry(session, saying: "That's a different tag. Hold the phone to the one you just tagged.")
                return
            }
            // NTAG21x is NFC Forum Type 2, which iOS gives us as a MIFARE tag.
            guard case let .miFare(ndefTag) = tag else {
                self.failWrite(session, "This kind of tag can't hold a link.", code: "NOT_NDEF")
                return
            }
            ndefTag.queryNDEFStatus { status, capacity, error in
                guard session === self.session else { return }
                if let error {
                    self.failWrite(session, error.localizedDescription, code: "WRITE_FAILED")
                    return
                }
                switch status {
                case .readWrite:
                    if message.length > capacity {
                        self.failWrite(session, "This tag is too small for the link.", code: "TOO_SMALL")
                        return
                    }
                    ndefTag.writeNDEF(message) { error in
                        guard session === self.session else { return }
                        if let error {
                            self.failWrite(session, error.localizedDescription, code: "WRITE_FAILED")
                            return
                        }
                        self.writeCall?.resolve(["uid": Self.identifier(of: tag).map { Int($0) }])
                        self.writeCall = nil
                        self.endReason = "done"
                        session.alertMessage = "Written."
                        session.invalidate()
                    }
                case .readOnly:
                    self.failWrite(session, "This tag is locked, so it can't be written.", code: "READ_ONLY")
                case .notSupported:
                    self.failWrite(session, "This tag isn't formatted for NDEF, so it can't hold a link.", code: "NOT_NDEF")
                @unknown default:
                    self.failWrite(session, "Couldn't write this tag.", code: "WRITE_FAILED")
                }
            }
        }
    }

    private func retry(_ session: NFCTagReaderSession, saying message: String) {
        session.alertMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            if session === self.session { session.restartPolling() }
        }
    }

    private func failWrite(_ session: NFCTagReaderSession, _ message: String, code: String) {
        answerWrite(error: message, code: code)
        session.invalidate(errorMessage: message)
    }

    /// Rejects a write still waiting for an answer, and forgets it. Safe to call when there's none.
    private func answerWrite(error message: String, code: String) {
        writeCall?.reject(message, code)
        writeCall = nil
        writeMessage = nil
        writeExpectedUid = nil
    }

    /// [{ tnf, type, id, payload }] from JS (numbers in byte arrays) as an NDEF message.
    private static func message(from value: Any?) -> NFCNDEFMessage? {
        guard let list = value as? [Any], !list.isEmpty else { return nil }
        var records: [NFCNDEFPayload] = []
        for entry in list {
            guard let record = entry as? [String: Any],
                  let tnf = (record["tnf"] as? NSNumber)?.uint8Value,
                  let format = NFCTypeNameFormat(rawValue: tnf) else { return nil }
            records.append(NFCNDEFPayload(
                format: format,
                type: bytes(record["type"]),
                identifier: bytes(record["id"]),
                payload: bytes(record["payload"])
            ))
        }
        return NFCNDEFMessage(records: records)
    }

    private static func bytes(_ value: Any?) -> Data {
        Data(((value as? [Any]) ?? []).compactMap { ($0 as? NSNumber).map { UInt8(truncatingIfNeeded: $0.intValue) } })
    }

    /// "04:A1:2B:…", as formatUid() in src/lib/nfc.ts writes it.
    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02X", $0) }.joined(separator: ":")
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
