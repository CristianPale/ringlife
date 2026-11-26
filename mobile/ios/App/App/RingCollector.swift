import Foundation
import CoreBluetooth
import UserNotifications

/// Raccoglitore in background (docs/adr/0026): si collega all'anello, manda le stesse richieste dell'app e salva i
/// pacchetti grezzi. Il protocollo lo legge il TypeScript all'apertura: qui solo richieste, checksum e trasporto.
final class RingCollector: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = RingCollector()

    // UUID del protocollo (docs/protocol.md): uguali su ogni R09.
    private static let commandService = CBUUID(string: "6e40fff0-b5a3-f393-e0a9-e50e24dcca9e")
    private static let commandWrite = CBUUID(string: "6e400002-b5a3-f393-e0a9-e50e24dcca9e")
    private static let commandNotify = CBUUID(string: "6e400003-b5a3-f393-e0a9-e50e24dcca9e")
    private static let bigService = CBUUID(string: "de5bf728-d711-4e47-af26-65e3012a5dc7")
    private static let bigWrite = CBUUID(string: "de5bf72a-d711-4e47-af26-65e3012a5dc7")
    private static let bigNotify = CBUUID(string: "de5bf729-d711-4e47-af26-65e3012a5dc7")

    /// L'identificativo dell'anello salvato dall'app (Capacitor Preferences scrive in UserDefaults con questo prefisso).
    private static let deviceKey = "CapacitorStorage.ring.device-id.v1"
    /// «Disconnetti» in RingLife (docs/adr/0030): finché vale "true" il raccoglitore non si collega all'anello.
    private static let unlinkedKey = "CapacitorStorage.ring.unlinked.v1"
    private static let runsFile = "ring-background-runs.json"
    private static let maxRuns = 20
    /// Registro dei tentativi, riusciti o no: l'app lo mostra in Impostazioni › Anello.
    private static let attemptsKey = "ring.background.attempts"
    private static let maxAttempts = 20
    /// Tetto predefinito di una lettura intera, dall'attesa del Bluetooth all'ultima risposta. Chi la chiede può
    /// stringerlo: il risveglio di iOS concede circa 30 secondi, e dopo la lettura serve tempo per la catena
    /// (docs/adr/0048).
    static let limitSeconds: TimeInterval = 25

    private struct Request {
        let tag: String
        let big: Bool
        let bytes: [UInt8]
    }

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var commandChar: CBCharacteristic?
    private var bigChar: CBCharacteristic?
    private var notifying = 0
    private var queue: [Request] = []
    private var current: Request?
    private var frames: [[String: String]] = []
    private var results: [[String: Any]] = []
    private var battery: Int?
    private var startedAt = Date()
    private var quiet: Timer?
    private var limit: Timer?
    private var completion: ((Bool) -> Void)?
    /// Chi ha chiesto la lettura: `background` (iOS) o `shortcut` (Comandi).
    private var source = "background"
    /// A che punto è la lettura: `bluetooth`, `connecting`, `services` o l'etichetta della richiesta in corso.
    private var stage = "bluetooth"
    private var total = 0
    /// L'esito dell'ultima lettura: lo legge l'azione di Comandi per dire perché non è riuscita.
    private(set) var lastOutcome = ""
    /// Inizio dell'ultima lettura, ms: la catena scrive il suo esito sulla riga giusta del registro.
    private(set) var lastStartMs = 0
    /// L'ultima lettura è finita a tempo scaduto, ma le richieste già complete sono state salvate.
    private(set) var lastPartial = false

    /// Una lettura è in corso: l'app avviata in background non deve interromperla (`appState`).
    var isCollecting: Bool {
        return completion != nil
    }
    /// Il tetto della lettura in corso.
    private var limitSecondsCurrent: TimeInterval = RingCollector.limitSeconds

    /// L'utente ha scollegato l'anello da RingLife: niente letture finché non lo riconnette.
    static var isUnlinked: Bool {
        return UserDefaults.standard.string(forKey: unlinkedKey) == "true"
    }

    /// Una lettura completa. `completion(true)` se è arrivata alla fine e i dati sono salvati. Ogni tentativo, riuscito o
    /// no, finisce nel registro (`attempts()`).
    func collect(source: String = "background", limit seconds: TimeInterval = RingCollector.limitSeconds,
                 completion: @escaping (Bool) -> Void) {
        if RingCollector.isUnlinked {
            lastOutcome = "unlinked"
            RingCollector.recordSkipped(source: source, outcome: "unlinked")
            completion(false)
            return
        }
        if self.completion != nil {
            // Una lettura rimasta appesa (per esempio il processo sospeso a metà) non blocca per sempre le successive.
            if Date().timeIntervalSince(startedAt) > limitSecondsCurrent + 15 {
                finish(saved: false, outcome: "stale")
            } else {
                lastOutcome = "busy"
                RingCollector.recordSkipped(source: source, outcome: "busy")
                completion(false)
                return
            }
        }
        self.source = source
        self.completion = completion
        limitSecondsCurrent = seconds
        startedAt = Date()
        lastStartMs = Int(startedAt.timeIntervalSince1970 * 1000)
        results = []
        battery = nil
        notifying = 0
        stage = "bluetooth"
        queue = RingCollector.requests(now: startedAt)
        total = queue.count
        // Il tetto vale da subito: anche un Bluetooth che non si accende mai chiude la lettura.
        limit = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.finish(saved: false, outcome: "time_limit")
        }
        central = CBCentralManager(delegate: self, queue: nil)
    }

    /// Il tempo concesso da iOS è finito (`expired`), o l'app legge l'anello da sé (`app_reading`): si chiude subito,
    /// senza salvare una lettura a metà. Senza una lettura in corso non fa niente.
    func cancel(reason: String = "expired") {
        guard completion != nil else { return }
        finish(saved: false, outcome: reason)
    }

    // MARK: - Richieste (le stesse dell'app, docs/protocol.md)

    private static func frame(_ bytes: [UInt8]) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: 16)
        for (i, b) in bytes.prefix(15).enumerated() {
            out[i] = b
        }
        let sum = out[0..<15].reduce(0) { $0 + Int($1) }
        out[15] = UInt8(sum & 0xff)
        return out
    }

    private static func bcd(_ value: Int) -> UInt8 {
        return UInt8((((value / 10) % 10) << 4) | (value % 10))
    }

    private static func requests(now: Date) -> [Request] {
        let calendar = Calendar.current
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let time = frame([0x01, bcd((c.year ?? 2000) % 100), bcd(c.month ?? 1), bcd(c.day ?? 1), bcd(c.hour ?? 0), bcd(c.minute ?? 0), bcd(c.second ?? 0), 0x06])
        var list: [Request] = [
            Request(tag: "time", big: false, bytes: time),
            Request(tag: "battery", big: false, bytes: frame([0x03])),
        ]
        let today = calendar.startOfDay(for: now)
        for day in 0...1 {
            list.append(Request(tag: "steps:\(day)", big: false, bytes: frame([0x43, UInt8(day), 0x0f, 0x00, 0x5f, 0x01])))
            // Battito: la mezzanotte del giorno in secondi «ora locale» (l'anello non ha fuso orario).
            let midnight = calendar.date(byAdding: .day, value: -day, to: today) ?? today
            let local = Int(midnight.timeIntervalSince1970) + TimeZone.current.secondsFromGMT(for: midnight)
            let le = [UInt8(local & 0xff), UInt8((local >> 8) & 0xff), UInt8((local >> 16) & 0xff), UInt8((local >> 24) & 0xff)]
            list.append(Request(tag: "hr:\(day)", big: false, bytes: frame([0x15] + le)))
            list.append(Request(tag: "stress:\(day)", big: false, bytes: frame([0x37, UInt8(day)])))
            list.append(Request(tag: "hrv:\(day)", big: false, bytes: frame([0x39, UInt8(day)])))
        }
        // Canale lungo: messaggi fissi, già con il CRC (gli stessi che manda l'app del produttore).
        list.append(Request(tag: "sleep", big: true, bytes: [0xbc, 0x27, 0x02, 0x00, 0x81, 0x80, 0xff, 0x01]))
        list.append(Request(tag: "spo2", big: true, bytes: [0xbc, 0x2a, 0x01, 0x00, 0xff, 0x00, 0xff]))
        list.append(Request(tag: "temp", big: true, bytes: [0xbc, 0x25, 0x01, 0x00, 0x3f, 0x42, 0x06]))
        return list
    }

    // MARK: - Collegamento

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else {
            switch central.state {
            case .poweredOff: finish(saved: false, outcome: "bluetooth_off")
            case .unauthorized: finish(saved: false, outcome: "bluetooth_unauthorized")
            case .unsupported: finish(saved: false, outcome: "bluetooth_unsupported")
            default: break
            }
            return
        }
        var target: CBPeripheral?
        if let id = UserDefaults.standard.string(forKey: RingCollector.deviceKey), let uuid = UUID(uuidString: id) {
            target = central.retrievePeripherals(withIdentifiers: [uuid]).first
        }
        if target == nil {
            target = central.retrieveConnectedPeripherals(withServices: [RingCollector.commandService]).first
        }
        guard let ring = target else {
            finish(saved: false, outcome: "ring_not_found")
            return
        }
        peripheral = ring
        ring.delegate = self
        stage = "connecting"
        central.connect(ring, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        stage = "services"
        peripheral.discoverServices([RingCollector.commandService, RingCollector.bigService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        finish(saved: false, outcome: "connect_failed")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for characteristic in service.characteristics ?? [] {
            switch characteristic.uuid {
            case RingCollector.commandWrite: commandChar = characteristic
            case RingCollector.bigWrite: bigChar = characteristic
            case RingCollector.commandNotify, RingCollector.bigNotify: peripheral.setNotifyValue(true, for: characteristic)
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        notifying += 1
        if notifying == 2 && current == nil {
            next()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value, current != nil else { return }
        let bytes = [UInt8](data)
        let channel = characteristic.uuid == RingCollector.bigNotify ? "big" : "command"
        frames.append(["ch": channel, "hex": bytes.map { String(format: "%02x", $0) }.joined()])
        if current?.tag == "battery", channel == "command", bytes.count > 1, bytes[0] == 0x03 {
            battery = Int(bytes[1])
        }
        armQuiet(0.8)
    }

    // MARK: - Sequenza delle richieste

    private func next() {
        if let request = current {
            results.append([
                "tag": request.tag,
                "request": request.bytes.map { String(format: "%02x", $0) }.joined(),
                "frames": frames,
            ])
        }
        frames = []
        guard !queue.isEmpty, let ring = peripheral else {
            current = nil
            finish(saved: true, outcome: "saved")
            return
        }
        let request = queue.removeFirst()
        current = request
        stage = request.tag
        guard let characteristic = request.big ? bigChar : commandChar else {
            next()
            return
        }
        ring.writeValue(Data(request.bytes), for: characteristic, type: .withoutResponse)
        // Una richiesta è finita quando l'anello tace per un po'; senza risposta si va avanti dopo 2,5 secondi.
        armQuiet(2.5)
    }

    private func armQuiet(_ seconds: TimeInterval) {
        quiet?.invalidate()
        quiet = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.next()
        }
    }

    private func finish(saved: Bool, outcome: String) {
        // Una richiamata che arriva a lettura già chiusa (timer, Bluetooth) non conta due volte.
        guard completion != nil else { return }
        // A tempo scaduto le richieste già complete si tengono: il caricamento sul server è idempotente, e una lettura
        // ferma all'ultima richiesta non butta le altre (docs/adr/0048, aggiornamento del 26 novembre).
        let partial = !saved && outcome == "time_limit" && !results.isEmpty
        let kept = saved || partial
        lastPartial = partial
        lastOutcome = partial ? "partial" : outcome
        RingCollector.record(
            source: source, start: startedAt, outcome: lastOutcome, stage: saved ? "" : stage, done: results.count, total: total)
        quiet?.invalidate()
        limit?.invalidate()
        quiet = nil
        limit = nil
        if kept {
            RingCollector.append(run: [
                "at": Int(startedAt.timeIntervalSince1970 * 1000),
                "tzOffsetMin": TimeZone.current.secondsFromGMT(for: startedAt) / 60,
                // JSON non accetta un Optional vuoto: senza batteria si scrive null.
                "battery": battery.map { $0 as Any } ?? NSNull(),
                "requests": results,
            ])
            UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: "ring.background.lastRun")
            RingWatch.reschedule()
        }
        if let ring = peripheral, let central = central {
            central.cancelPeripheralConnection(ring)
        }
        if let level = battery {
            BatteryAlerts.check(percent: level)
        }
        peripheral = nil
        commandChar = nil
        bigChar = nil
        central = nil
        current = nil
        queue = []
        let done = completion
        completion = nil
        done?(kept)
    }

    // MARK: - Letture salvate

    private static func fileURL() -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(runsFile)
    }

    private static func append(run: [String: Any]) {
        guard let url = fileURL() else { return }
        var runs: [Any] = []
        if let data = try? Data(contentsOf: url), let list = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            runs = list
        }
        runs.append(run)
        if runs.count > maxRuns {
            runs.removeFirst(runs.count - maxRuns)
        }
        if let data = try? JSONSerialization.data(withJSONObject: runs) {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: - Registro dei tentativi

    private static func record(source: String, start: Date, outcome: String, stage: String, done: Int, total: Int) {
        let entry: [String: Any] = [
            "at": Int(start.timeIntervalSince1970 * 1000),
            "end": Int(Date().timeIntervalSince1970 * 1000),
            "source": source,
            "outcome": outcome,
            "stage": stage,
            "done": done,
            "total": total,
        ]
        let defaults = UserDefaults.standard
        var list: [Any] = []
        if let text = defaults.string(forKey: attemptsKey), let data = text.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            list = parsed
        }
        list.append(entry)
        if list.count > maxAttempts {
            list.removeFirst(list.count - maxAttempts)
        }
        if let data = try? JSONSerialization.data(withJSONObject: list), let text = String(data: data, encoding: .utf8) {
            defaults.set(text, forKey: attemptsKey)
        }
    }

    /// Fin dove è arrivata la catena dopo la lettura che è cominciata in `at` (docs/adr/0048).
    static func annotate(at: Int, chain: String) {
        let defaults = UserDefaults.standard
        guard let text = defaults.string(forKey: attemptsKey), let data = text.data(using: .utf8),
              var list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        guard let index = list.lastIndex(where: { ($0["at"] as? Int) == at }) else { return }
        list[index]["chain"] = chain
        if let out = try? JSONSerialization.data(withJSONObject: list), let json = String(data: out, encoding: .utf8) {
            defaults.set(json, forKey: attemptsKey)
        }
    }

    /// Un tentativo che non arriva a collegarsi (anello scollegato, un'altra lettura in corso, app aperta).
    static func recordSkipped(source: String, outcome: String) {
        record(source: source, start: Date(), outcome: outcome, stage: "", done: 0, total: 0)
    }

    /// Il registro dei tentativi, in JSON, dal più vecchio. Non si svuota: tiene gli ultimi `maxAttempts`.
    static func attempts() -> String {
        return UserDefaults.standard.string(forKey: attemptsKey) ?? "[]"
    }

    /// Le letture salvate, in JSON, e le toglie: l'app le mette nella sua coda d'invio.
    static func drain() -> String {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else { return "[]" }
        try? FileManager.default.removeItem(at: url)
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}

/// Avvisi della batteria (docs/adr/0026): al 20% e al 10%, una volta per soglia; si riarmano sopra il 25%.
enum BatteryAlerts {
    static let enabledKey = "ring.battery.alerts"
    private static let lastKey = "ring.battery.alerted"

    static func check(percent: Int) {
        let defaults = UserDefaults.standard
        if percent > 25 {
            defaults.set(0, forKey: lastKey)
            return
        }
        guard defaults.object(forKey: enabledKey) == nil || defaults.bool(forKey: enabledKey) else { return }
        let last = defaults.integer(forKey: lastKey)
        var threshold = 0
        if percent <= 10 && last != 10 {
            threshold = 10
        } else if percent <= 20 && last == 0 {
            threshold = 20
        }
        guard threshold > 0 else { return }
        defaults.set(threshold, forKey: lastKey)
        let content = UNMutableNotificationContent()
        content.title = "Anello quasi scarico"
        content.body = "La batteria dell'anello è al \(percent)%. Mettilo in carica quando puoi."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "ring-battery-\(threshold)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }
}
