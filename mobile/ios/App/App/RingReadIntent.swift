import AppIntents
import UIKit

/// «Leggi l'anello» per Comandi (docs/adr/0026): un'automazione a orario lo esegue anche con l'app chiusa scorrendo,
/// perché iOS avvia l'app in background solo per l'azione. Stesso raccoglitore della lettura in background.
@available(iOS 16.0, *)
struct RingReadIntent: AppIntent {
    static let title: LocalizedStringResource = "Leggi l'anello"
    static let description = IntentDescription("Legge l'anello in background e conserva i dati fino alla prossima apertura di RingLife.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Con l'app aperta legge già l'app: due collegamenti insieme all'anello si disturbano.
        let active = await MainActor.run { UIApplication.shared.applicationState == .active }
        if active {
            RingCollector.recordSkipped(source: "shortcut", outcome: "app_active")
            return .result(dialog: "RingLife è aperta: legge l'anello da sé.")
        }
        if RingCollector.isUnlinked {
            RingCollector.recordSkipped(source: "shortcut", outcome: "unlinked")
            return .result(dialog: "L'anello è scollegato da RingLife: ricollegalo da Impostazioni nell'app.")
        }
        // 20 secondi per la lettura e 8 per la catena: invio e avvisi senza aprire l'app (docs/adr/0048).
        let (saved, outcome) = await withCheckedContinuation { (continuation: CheckedContinuation<(Bool, String), Never>) in
            DispatchQueue.main.async {
                RingCollector.shared.collect(source: "shortcut", limit: 20) { saved in
                    continuation.resume(returning: (saved, RingCollector.shared.lastOutcome))
                }
            }
        }
        if saved {
            let chain = await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
                DispatchQueue.main.async {
                    BackgroundChain.shared.run(source: "shortcut", budget: 8) { chain in
                        continuation.resume(returning: chain)
                    }
                }
            }
            let partial = await MainActor.run { RingCollector.shared.lastPartial }
            let read = partial ? "Anello letto in parte (tempo scaduto)" : "Anello letto"
            if chain == "alerts" || chain == "uploaded" {
                return .result(dialog: "\(read) e dati inviati al server di casa.")
            }
            return .result(dialog: "\(read).")
        }
        return .result(dialog: "Anello non letto (\(RingReadIntent.reason(outcome))). Il motivo resta in Impostazioni › Anello.")
    }
}

@available(iOS 16.0, *)
extension RingReadIntent {
    /// Il motivo in poche parole; il dettaglio (a che punto si è fermata) lo mostra l'app.
    static func reason(_ outcome: String) -> String {
        switch outcome {
        case "time_limit": return "tempo scaduto"
        case "ring_not_found": return "il telefono non trova l'anello"
        case "connect_failed": return "collegamento non riuscito"
        case "bluetooth_off": return "Bluetooth spento"
        case "bluetooth_unauthorized": return "manca il permesso Bluetooth"
        case "busy": return "un'altra lettura in corso"
        case "expired", "app_reading": return "interrotta"
        default: return "errore"
        }
    }
}

/// Fa comparire l'azione in Comandi senza doverla cercare.
@available(iOS 16.0, *)
struct RingLifeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: RingReadIntent(), phrases: ["Leggi l'anello con \(.applicationName)"])
    }
}
