import CryptoKit
import Foundation
import Security
import UserNotifications

/// Estensione delle notifiche (docs/adr/0047): una push del server di casa arriva con il testo di riserva «Avviso di
/// RingLife» e, nel campo `rl`, titolo, testo e pagina cifrati con AES-256-GCM. Qui si decifrano con la chiave che
/// l'app ha salvato nel portachiavi condiviso, prima che la notifica si veda. Se non si riesce (chiave cambiata o
/// assente), resta il testo di riserva: l'avviso è comunque nell'elenco dell'app.
///
/// Target `RingLifeNotifications` del progetto Xcode; configurazione di Apple in `docs/release/PUSH-CIFRATE.md`.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        handler = contentHandler
        let mutable = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        content = mutable
        if let payload = request.content.userInfo["rl"] as? [String: Any],
           let sealed = payload["c"] as? String,
           let plain = PushCrypto.open(sealed),
           let alert = (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any] {
            if let title = alert["title"] as? String {
                mutable.title = title
            }
            if let body = alert["body"] as? String {
                mutable.body = body
            }
            var info = mutable.userInfo
            info["route"] = (alert["route"] as? String) ?? "/avvisi"
            if let ids = alert["ids"] {
                info["ids"] = ids
            }
            info.removeValue(forKey: "rl")
            mutable.userInfo = info
        }
        contentHandler(mutable)
        handler = nil
    }

    /// iOS sta per mostrare la notifica com'è: si consegna quello che c'è (il testo di riserva).
    override func serviceExtensionTimeWillExpire() {
        if let handler = handler, let content = content {
            handler(content)
        }
        handler = nil
    }
}

/// La stessa chiave dell'app (`PushKey` in `RingBackgroundPlugin.swift`): stessi servizio, account e gruppo.
enum PushCrypto {
    private static let service = "com.ringlife.app.push"
    private static let account = "alert-key"

    /// `nonce (12 byte) ‖ testo cifrato ‖ tag (16 byte)` in base64, il formato «combined» di CryptoKit.
    static func open(_ base64: String) -> Data? {
        guard let combined = Data(base64Encoded: base64), let key = loadKey(),
              let box = try? AES.GCM.SealedBox(combined: combined) else {
            return nil
        }
        return try? AES.GCM.open(box, using: SymmetricKey(data: key))
    }

    private static func loadKey() -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = Bundle.main.object(forInfoDictionaryKey: "RingLifeKeychainGroup") as? String, !group.isEmpty {
            query[kSecAttrAccessGroup as String] = group
        }
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data, data.count == 32 else {
            return nil
        }
        return data
    }
}
