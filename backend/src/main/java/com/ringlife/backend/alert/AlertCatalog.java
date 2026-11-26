package com.ringlife.backend.alert;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The built-in alert rules of phase 1 (ADR 0045): what each one is, which parameters it has and its defaults. The
 * rules read values that the daily computation and the plugins already produce: no new formula, so no `algo_version`;
 * each rule has its own `version`, like a plugin.
 */
final class AlertCatalog {

    private AlertCatalog() {}

    static final String ATTENTION = "attenzione";
    static final String HIGH = "alto";

    static final String NOTIFY = "notifica";
    static final String IMPORTANT = "importante";
    static final String LIST_ONLY = "elenco";
    static final List<String> DELIVERIES = List.of(NOTIFY, IMPORTANT, LIST_ONLY);

    static final String SENSITIVE = "sensibile";
    static final String NORMAL = "normale";
    static final String LARGE = "grandi";

    /** Sensitivity S of the rules on your average, in deviations from it. */
    static final Map<String, Double> SENSITIVITIES = sensitivities();

    /** The weaker condition of the «N nights in a row» rules: at least one deviation from your average. */
    static final double STREAK_DEVIATION = 1.0;

    static final String FATIGUE = "fatigue";
    static final String TEMPERATURE = "temperature";
    static final String RESTING_HR = "resting-hr";
    static final String HRV = "hrv";
    static final String BREATHING = "breathing";
    static final String RECOVERY_LOW = "recovery-low";
    static final String MIGRAINE_RISK = "migraine-risk";
    static final String SLEEP_DEBT = "sleep-debt";
    static final String STEPS_LOW = "steps-low";

    /** Hour of the day (local) before which a sleep debt alert is not delivered. */
    static final int SLEEP_DEBT_HOUR = 21;

    /** Allowed «days in a row». */
    record DaysRange(int min, int max) {}

    /** Allowed threshold, in its unit; `step` is the increment the app offers. */
    record ThresholdRange(String unit, double min, double max, double step) {}

    /** Which parameters a rule has: sensitivity or not, days in a row (null = none), threshold (null = none). */
    record Params(boolean sensitivity, DaysRange days, ThresholdRange threshold) {}

    /** A rule's configuration: on or off and the values of its parameters (null for the parameters it does not have). */
    record RuleConfig(boolean enabled, String sensitivity, Integer days, Double threshold, String delivery) {

        /** S in deviations, for the rules with a sensitivity. */
        double sensitivityDeviations() {
            return SENSITIVITIES.get(sensitivity);
        }
    }

    /**
     * A built-in rule. `pluginId` is set for the rules fed by a plugin through `PluginResult.alerts`: they fire only
     * while that plugin is on. `route` is the app page the event opens. `lastNight` marks the rules that depend on the
     * night ending on the evaluated day: they wait until that night is over (see `FinishedNights`).
     */
    record Definition(
            String id,
            String version,
            String name,
            String description,
            String level,
            boolean usesAverage,
            boolean lastNight,
            Params params,
            RuleConfig defaults,
            String route,
            String pluginId) {}

    /** General settings of a device: quiet hours, lock screen text, publication in Home Assistant. */
    record Settings(String quietStart, String quietEnd, String lockScreen, boolean homeAssistant) {}

    static final String LOCK_SHORT = "breve";
    static final String LOCK_GENERIC = "generico";
    static final List<String> LOCK_SCREENS = List.of(LOCK_SHORT, LOCK_GENERIC);

    static final Settings DEFAULT_SETTINGS = new Settings("22:30", "07:00", LOCK_SHORT, false);

    private static final String RECOVERY_PAGE = "/indici/recupero";
    private static final String SLEEP_PAGE = "/tabs/sonno";

    private static final Params NONE = new Params(false, null, null);
    private static final DaysRange NIGHTS = new DaysRange(2, 7);
    private static final DaysRange DAYS = new DaysRange(1, 7);

    static final List<Definition> ALL = List.of(
            new Definition(
                    FATIGUE, "1", "Segnali di affaticamento",
                    "Battito a riposo sopra, variabilità del battito (HRV) sotto e temperatura della notte sopra la tua media, tutti e tre insieme.",
                    HIGH, true, true, NONE, on(null, null, null), RECOVERY_PAGE, null),
            new Definition(
                    TEMPERATURE, "1", "Temperatura della notte",
                    "Temperatura della notte sopra la tua media: di molto in una notte, oppure di poco per più notti di fila.",
                    ATTENTION, true, true, new Params(true, NIGHTS, null), on(NORMAL, 2, null), RECOVERY_PAGE, null),
            new Definition(
                    RESTING_HR, "1", "Battito a riposo",
                    "Battito a riposo della notte sopra la tua media: di molto in una notte, oppure di poco per più notti di fila.",
                    ATTENTION, true, true, new Params(true, NIGHTS, null), on(NORMAL, 3, null), RECOVERY_PAGE, null),
            new Definition(
                    HRV, "1", "Variabilità del battito (HRV)",
                    "Variabilità del battito (HRV) della notte sotto la tua media: di molto in una notte, oppure di poco per più notti di fila.",
                    ATTENTION, true, true, new Params(true, NIGHTS, null), on(NORMAL, 3, null), RECOVERY_PAGE, null),
            new Definition(
                    BREATHING, "1", "Respiro notturno",
                    "Ossigeno della notte (SpO2) sotto la tua media per 3 notti di fila. Nessuna soglia assoluta.",
                    HIGH, true, true, NONE, on(null, null, null), SLEEP_PAGE, null),
            new Definition(
                    RECOVERY_LOW, "1", "Recupero basso",
                    "Recupero sotto la soglia per più giorni di fila.",
                    ATTENTION, true, true, new Params(false, DAYS, new ThresholdRange("punti", 30, 90, 1)), on(null, 3, 70.0),
                    RECOVERY_PAGE, null),
            new Definition(
                    MIGRAINE_RISK, "1", "Rischio emicrania",
                    "Rischio di cefalea alto secondo il plugin Emicrania. Funziona solo con il plugin acceso.",
                    HIGH, false, true, NONE, on(null, null, null), "/plugin/migraine", "migraine"),
            new Definition(
                    SLEEP_DEBT, "1", "Debito di sonno",
                    "Debito di sonno degli ultimi 7 giorni oltre la soglia. Arriva la sera, non prima delle 21.",
                    ATTENTION, false, true, new Params(false, null, new ThresholdRange("h", 1, 20, 0.5)), off(null, 6.0),
                    SLEEP_PAGE, null),
            new Definition(
                    STEPS_LOW, "1", "Passi bassi",
                    "Passi sotto la soglia per più giorni di fila. Contano solo i giorni finiti.",
                    ATTENTION, false, false, new Params(false, DAYS, new ThresholdRange("passi", 500, 20000, 100)), off(3, 4000.0),
                    "/indici/movimento", null));

    static Optional<Definition> byId(String id) {
        return ALL.stream().filter(d -> d.id().equals(id)).findFirst();
    }

    private static RuleConfig on(String sensitivity, Integer days, Double threshold) {
        return new RuleConfig(true, sensitivity, days, threshold, NOTIFY);
    }

    private static RuleConfig off(Integer days, Double threshold) {
        return new RuleConfig(false, null, days, threshold, NOTIFY);
    }

    private static Map<String, Double> sensitivities() {
        Map<String, Double> values = new LinkedHashMap<>();
        values.put(SENSITIVE, 1.5);
        values.put(NORMAL, 2.0);
        values.put(LARGE, 2.5);
        return java.util.Collections.unmodifiableMap(values);
    }
}
