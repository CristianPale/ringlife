import Foundation
import UIKit
import Capacitor
import BackgroundTasks
import Security
import UserNotifications

/// Il ponte tra l'app e la lettura in background (docs/adr/0026).
@objc(RingBackgroundPlugin)
public class RingBackgroundPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "RingBackgroundPlugin"
    public let jsName = "RingBackground"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attempts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "batteryReading", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ringRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chainStep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openShortcuts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushRegister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushUnregister", returnType: CAPPluginReturnPromise),
    ]

    private var readObserver: NSObjectProtocol?

    override public func load() {
        // Le notifiche si vedono anche con l'app aperta.
        UNUserNotificationCenter.current().delegate = self
        // Una lettura in background salvata: la pagina web fa la catena (docs/adr/0048).
        readObserver = NotificationCenter.default.addObserver(
            forName: BackgroundChain.readNotification, object: nil, queue: .main
        ) { [weak self] note in
            let source = note.userInfo?["source"] as? String ?? "background"
            self?.notifyListeners("backgroundRead", data: ["source": source])
        }
    }

    deinit {
        if let observer = readObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Un passo della catena dalla pagina web (docs/adr/0048).
    @objc func chainStep(_ call: CAPPluginCall) {
        let step = call.getString("step") ?? ""
        DispatchQueue.main.async {
            BackgroundChain.shared.report(step)
            call.resolve()
        }
    }

    /// Chiede a iOS il token delle push e dà la chiave di cifratura (docs/adr/0047): `ok` con `token` (esadecimale),
    /// `key` (base64, 32 byte) e `environment`, oppure `ok: false` con il motivo. Non lancia.
    @objc func pushRegister(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else {
                call.resolve(["ok": false, "reason": "denied"])
                return
            }
            guard let key = PushKey.loadOrCreate() else {
                call.resolve(["ok": false, "reason": "keychain"])
                return
            }
            DispatchQueue.main.async {
                PushRegistrar.shared.register { result in
                    switch result {
                    case .success(let token):
                        call.resolve([
                            "ok": true,
                            "token": token.map { String(format: "%02x", $0) }.joined(),
                            "key": key.base64EncodedString(),
                            "environment": PushRegistrar.environment,
                        ])
                    case .failure(let error):
                        let text = (error as NSError).localizedDescription
                        // Senza l'entitlement `aps-environment` iOS rifiuta sempre: manca la configurazione Apple.
                        let reason = text.contains("aps-environment") ? "not_configured" : "failed"
                        call.resolve(["ok": false, "reason": reason])
                    }
                }
            }
        }
    }

    /// Spegne le push su questo telefono: toglie la chiave, così una push vecchia non si decifra più.
    @objc func pushUnregister(_ call: CAPPluginCall) {
        PushKey.delete()
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
            call.resolve()
        }
    }

    /// Apre Comandi, per creare le automazioni consigliate (docs/adr/0048).
    @objc func openShortcuts(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: "shortcuts://") else {
                call.resolve()
                return
            }
            UIApplication.shared.open(url, options: [:]) { _ in
                call.resolve()
            }
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// Il tocco su un avviso apre la sua pagina nell'app (docs/adr/0045). Tenuto finché la pagina web non lo legge.
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        if let route = info["route"] as? String {
            notifyListeners("notificationTap", data: ["route": route], retainUntilConsumed: true)
        } else if info["rl"] != nil {
            // Una push che l'estensione non ha decifrato: l'avviso è comunque nell'elenco (docs/adr/0047).
            notifyListeners("notificationTap", data: ["route": "/avvisi"], retainUntilConsumed: true)
        }
        completionHandler()
    }

    /// Una notifica locale (docs/adr/0045): subito, o all'ora `at` (ms dall'epoca). `important` chiede il livello
    /// «time-sensitive»: senza la capability sull'App ID iOS la consegna come una notifica normale.
    @objc func notify(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let title = call.getString("title") else {
            call.reject("id e title servono")
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = call.getString("body") ?? ""
        content.sound = .default
        content.threadIdentifier = "alerts"
        if let route = call.getString("route") {
            content.userInfo = ["route": route]
        }
        if #available(iOS 15.0, *), call.getBool("important") ?? false {
            content.interruptionLevel = .timeSensitive
        }
        var trigger: UNNotificationTrigger?
        if let at = call.getDouble("at") {
            let seconds = at / 1000 - Date().timeIntervalSince1970
            if seconds > 1 {
                trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
            }
        }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) { _ in
                call.resolve()
            }
        }
    }

    @objc func cancelNotifications(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
        call.resolve()
    }

    /// Una lettura in primo piano è riuscita: il promemoria «anello non letto» si sposta in avanti.
    @objc func ringRead(_ call: CAPPluginCall) {
        RingWatch.reschedule()
        call.resolve()
    }

    /// Intervallo minimo in minuti (0 = spenta) e avvisi della batteria.
    @objc func configure(_ call: CAPPluginCall) {
        let interval = call.getInt("intervalMin") ?? 0
        let alerts = call.getBool("batteryAlerts") ?? true
        UserDefaults.standard.set(interval, forKey: RingBackgroundTask.intervalKey)
        UserDefaults.standard.set(alerts, forKey: BatteryAlerts.enabledKey)
        // Ore senza letture prima del promemoria «anello non letto» (docs/adr/0045); 0 = spento.
        UserDefaults.standard.set(call.getInt("ringWatchHours") ?? RingWatch.defaultHours, forKey: RingWatch.hoursKey)
        // Risveglio abituale in minuti dalla mezzanotte per il compito notturno; -1 = spento (docs/adr/0048).
        UserDefaults.standard.set(call.getInt("wakeMin") ?? -1, forKey: NightReadTask.wakeKey)
        RingWatch.reschedule()
        RingBackgroundTask.schedule()
        NightReadTask.schedule()
        if alerts {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        call.resolve()
    }

    @objc func drain(_ call: CAPPluginCall) {
        // L'app sta per leggere l'anello da sé (docs/adr/0027): una lettura in background ancora in corso si ferma,
        // così i due collegamenti non mandano comandi insieme. Le letture già salvate restano e si prendono qui sotto.
        DispatchQueue.main.async {
            RingCollector.shared.cancel(reason: "app_reading")
        }
        let lastRun = UserDefaults.standard.double(forKey: "ring.background.lastRun")
        call.resolve(["json": RingCollector.drain(), "lastRun": lastRun])
    }

    /// Il registro dei tentativi di lettura in background, riusciti o no (JSON). Non toglie niente.
    @objc func attempts(_ call: CAPPluginCall) {
        call.resolve(["json": RingCollector.attempts()])
    }

    /// `background: true` se iOS ha avviato l'app in background (Comandi, BGAppRefreshTask): la lettura d'apertura
    /// aspetta il primo piano, altrimenti interromperebbe il raccoglitore con `drain` (docs/adr/0026).
    @objc func appState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Avviata da Comandi, l'app può risultare «inattiva» invece che in background mentre il raccoglitore legge:
            // anche allora la lettura d'apertura aspetta, altrimenti la interromperebbe (docs/adr/0048).
            let state = UIApplication.shared.applicationState
            let collecting = RingCollector.shared.isCollecting
            call.resolve([
                "background": state == .background || (state != .active && collecting),
                "collecting": collecting,
            ])
        }
    }

    /// Una lettura in primo piano ha letto la batteria: stessi avvisi del background.
    @objc func batteryReading(_ call: CAPPluginCall) {
        if let percent = call.getInt("percent") {
            BatteryAlerts.check(percent: percent)
        }
        call.resolve()
    }
}

/// Il risveglio in background che iOS concede (BGAppRefreshTask): non prima dell'intervallo scelto.
enum RingBackgroundTask {
    static let identifier = "com.ringlife.app.refresh"
    static let intervalKey = "ring.background.intervalMin"

    /// Da `AppDelegate`, prima che l'avvio finisca.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refresh)
        }
    }

    static func schedule() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let interval = UserDefaults.standard.integer(forKey: intervalKey)
        guard interval > 0 else { return }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(interval * 60))
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        // Il prossimo risveglio si chiede subito: se questo viene interrotto, il giro continua.
        schedule()
        task.expirationHandler = {
            // Il raccoglitore vive sul thread principale, come il suo CBCentralManager.
            DispatchQueue.main.async {
                RingCollector.shared.cancel(reason: "expired")
                BackgroundChain.shared.expire()
            }
        }
        // Circa 30 secondi in tutto: 18 per la lettura, 8 per la catena (docs/adr/0048).
        DispatchQueue.main.async {
            RingCollector.shared.collect(source: "background", limit: 18) { saved in
                guard saved else {
                    task.setTaskCompleted(success: false)
                    return
                }
                BackgroundChain.shared.run(source: "background", budget: 8) { _ in
                    task.setTaskCompleted(success: true)
                }
            }
        }
    }
}

/// Il compito notturno (docs/adr/0048): iOS lo concede con il telefono inattivo, spesso in carica. Chiesto «non prima»
/// del risveglio abituale più 40 minuti, quando la notte è finita da più di 30: il server può già creare gli avvisi
/// della notte. Segue l'interruttore della lettura in background.
enum NightReadTask {
    static let identifier = "com.ringlife.app.night"
    static let wakeKey = "ring.background.wakeMin"
    private static let afterWakeMinutes = 40

    /// Da `AppDelegate`, prima che l'avvio finisca.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let processing = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(processing)
        }
    }

    static func schedule(after now: Date = Date()) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let defaults = UserDefaults.standard
        let wake = defaults.object(forKey: wakeKey) == nil ? -1 : defaults.integer(forKey: wakeKey)
        let interval = defaults.integer(forKey: RingBackgroundTask.intervalKey)
        guard wake >= 0, interval > 0, !RingCollector.isUnlinked else { return }
        let request = BGProcessingTaskRequest(identifier: identifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = nextDate(minuteOfDay: (wake + afterWakeMinutes) % 1440, after: now)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// La prossima volta, dopo `now`, che l'orologio segna quel minuto del giorno (ora locale).
    static func nextDate(minuteOfDay: Int, after now: Date) -> Date {
        let calendar = Calendar.current
        guard let today = calendar.date(bySettingHour: minuteOfDay / 60, minute: minuteOfDay % 60, second: 0, of: now) else {
            return now
        }
        if today > now {
            return today
        }
        return calendar.date(byAdding: .day, value: 1, to: today) ?? today
    }

    private static func handle(_ task: BGProcessingTask) {
        // Il giorno dopo si chiede subito: anche se questo viene interrotto, il giro continua.
        schedule(after: Date().addingTimeInterval(3600))
        task.expirationHandler = {
            DispatchQueue.main.async {
                RingCollector.shared.cancel(reason: "expired")
                BackgroundChain.shared.expire()
            }
        }
        DispatchQueue.main.async {
            RingCollector.shared.collect(source: "night", limit: 25) { saved in
                guard saved else {
                    task.setTaskCompleted(success: false)
                    return
                }
                BackgroundChain.shared.run(source: "night", budget: 20) { _ in
                    task.setTaskCompleted(success: true)
                }
            }
        }
    }
}

/// La catena dopo una lettura salvata in background (docs/adr/0048): la pagina web decodifica, invia al server e
/// scarica gli avvisi. Il nativo aspetta i suoi passi (`chainStep`) e chiude il compito all'ultimo, o allo scadere del
/// tempo. Se la pagina web non risponde entro 2 secondi (non avviata), chiude subito: i dati aspettano l'apertura.
/// Vive sul thread principale.
final class BackgroundChain {
    static let shared = BackgroundChain()
    static let readNotification = Notification.Name("RingLifeBackgroundRead")

    private var completion: ((String) -> Void)?
    private var attemptAt = 0
    private var reached = ""
    private var ack: Timer?
    private var limit: Timer?

    /// Dopo una lettura salvata. `completion` riceve fin dove è arrivata: `no_page`, `decoded`, `uploaded`,
    /// `alerts`, `failed`, `skipped` o `timeout`.
    func run(source: String, budget: TimeInterval, completion: @escaping (String) -> Void) {
        // Una catena precedente rimasta aperta si chiude ora: il suo compito è comunque finito.
        finish("timeout")
        self.completion = completion
        attemptAt = RingCollector.shared.lastStartMs
        reached = ""
        ack = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
            guard let self = self, self.reached.isEmpty else { return }
            self.finish("no_page")
        }
        limit = Timer.scheduledTimer(withTimeInterval: budget, repeats: false) { [weak self] _ in
            self?.finish("timeout")
        }
        NotificationCenter.default.post(name: BackgroundChain.readNotification, object: nil, userInfo: ["source": source])
    }

    /// Un passo dalla pagina web: `started`, `decoded` e `uploaded` vanno avanti; `alerts`, `failed` e `skipped`
    /// chiudono; `stop` chiude con l'ultimo passo raggiunto.
    func report(_ step: String) {
        guard completion != nil else { return }
        switch step {
        case "started":
            if reached.isEmpty {
                reached = "started"
            }
        case "decoded", "uploaded":
            reached = step
        case "alerts", "failed", "skipped":
            finish(step)
        case "stop":
            finish(reached == "decoded" || reached == "uploaded" ? reached : "failed")
        default:
            break
        }
    }

    /// iOS toglie il tempo: si chiude con quello che c'è.
    func expire() {
        finish("timeout")
    }

    private func finish(_ outcome: String) {
        ack?.invalidate()
        limit?.invalidate()
        ack = nil
        limit = nil
        guard let done = completion else { return }
        completion = nil
        // A tempo scaduto il registro dice fin dove era arrivata: decodificata o inviata dice più di «timeout».
        var result = outcome
        if outcome == "timeout" {
            if reached == "decoded" || reached == "uploaded" {
                result = reached
            } else if reached.isEmpty {
                result = "no_page"
            }
        }
        RingCollector.annotate(at: attemptAt, chain: result)
        done(result)
    }
}

/// «Anello non letto» (docs/adr/0045): una notifica programmata a N ore, spostata in avanti a ogni lettura riuscita,
/// in primo piano e in background. Se non legge più nessuno scatta da sola, anche con l'app chiusa.
enum RingWatch {
    static let hoursKey = "ring.watch.hours"
    static let defaultHours = 24
    private static let identifier = "ring-not-read"

    static func reschedule() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        let defaults = UserDefaults.standard
        let hours = defaults.object(forKey: hoursKey) == nil ? defaultHours : defaults.integer(forKey: hoursKey)
        guard hours > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Anello non letto da \(hours) ore"
        content.body = "Apri RingLife con l'anello vicino al telefono, o controlla che sia carico."
        content.sound = .default
        content.userInfo = ["route": "/impostazioni/anello"]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(hours * 3600), repeats: false)
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger), withCompletionHandler: nil)
    }
}

/// Il token delle push (docs/adr/0047): `AppDelegate` passa qui le risposte di iOS. Sul thread principale.
final class PushRegistrar {
    static let shared = PushRegistrar()

    /// TestFlight e App Store usano l'APNs di produzione; una build di sviluppo da Xcode quello di prova.
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    private var waiting: [(Result<Data, Error>) -> Void] = []
    private var timer: Timer?

    func register(completion: @escaping (Result<Data, Error>) -> Void) {
        waiting.append(completion)
        guard waiting.count == 1 else { return }
        // Senza risposta di iOS (rete assente) non si aspetta per sempre.
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            self?.finish(.failure(NSError(domain: "RingLifePush", code: 1, userInfo: [NSLocalizedDescriptionKey: "timeout"])))
        }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(token: Data) {
        DispatchQueue.main.async { self.finish(.success(token)) }
    }

    func didFail(error: Error) {
        DispatchQueue.main.async { self.finish(.failure(error)) }
    }

    private func finish(_ result: Result<Data, Error>) {
        timer?.invalidate()
        timer = nil
        let callbacks = waiting
        waiting = []
        callbacks.forEach { $0(result) }
    }
}

/// La chiave AES-256 con cui il server cifra il testo delle push (docs/adr/0047). Sta nel portachiavi; con
/// `RingLifeKeychainGroup` in `Info.plist` sta nel gruppo condiviso con l'estensione delle notifiche, che la legge con
/// gli stessi servizio e account (`mobile/ios/App/RingLifeNotifications/NotificationService.swift`).
enum PushKey {
    static let service = "com.ringlife.app.push"
    static let account = "alert-key"

    private static var group: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "RingLifeKeychainGroup") as? String
        return value?.isEmpty == false ? value : nil
    }

    private static func query() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = group {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    static func load() -> Data? {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess, let data = item as? Data, data.count == 32 else {
            return nil
        }
        return data
    }

    static func loadOrCreate() -> Data? {
        if let key = load() {
            return key
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        let key = Data(bytes)
        var item = query()
        item[kSecValueData as String] = key
        // Leggibile dopo il primo sblocco: l'estensione decifra anche con il telefono bloccato.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemDelete(query() as CFDictionary)
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { return nil }
        return key
    }

    static func delete() {
        SecItemDelete(query() as CFDictionary)
    }
}
