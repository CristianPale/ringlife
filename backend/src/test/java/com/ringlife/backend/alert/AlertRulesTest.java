package com.ringlife.backend.alert;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.alert.AlertCatalog.RuleConfig;
import com.ringlife.backend.alert.AlertRules.Draft;
import com.ringlife.backend.compute.History.DayResults;

/** The built-in alert rules (ADR 0045) on synthetic days: no real value anywhere. */
class AlertRulesTest {

    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);

    /** A synthetic day, built field by field. */
    private static final class Day {
        final LocalDate date;
        final Map<String, Integer> scores = new HashMap<>();
        final Map<String, Double> metrics = new HashMap<>();
        final Map<String, Double> features = new HashMap<>();
        final Map<String, Double> deviations = new HashMap<>();
        final Map<String, Double> medians = new HashMap<>();
        final Map<String, Map<String, Object>> details = new HashMap<>();

        Day(LocalDate date) {
            this.date = date;
        }

        Day score(String kind, int value) {
            scores.put(kind, value);
            return this;
        }

        Day metric(String name, double value) {
            metrics.put(name, value);
            return this;
        }

        Day detail(String metric, Map<String, Object> detail) {
            details.put(metric, detail);
            return this;
        }

        /** A feature with its median and deviation from your average. */
        Day night(String feature, double value, double median, double deviation) {
            features.put(feature, value);
            medians.put(feature, median);
            deviations.put(feature, deviation);
            return this;
        }

        Day feature(String feature, double value) {
            features.put(feature, value);
            return this;
        }

        DayResults build() {
            return new DayResults(date, scores, metrics, features, deviations, medians, details);
        }
    }

    private static Day day(int daysAgo) {
        return new Day(TODAY.minusDays(daysAgo));
    }

    private static AlertRules.Days days(Day... days) {
        Map<LocalDate, DayResults> byDay = new HashMap<>();
        for (Day d : days) {
            byDay.put(d.date, d.build());
        }
        return byDay::get;
    }

    private static RuleConfig defaults(String rule) {
        return AlertCatalog.byId(rule).orElseThrow().defaults();
    }

    private static RuleConfig with(String rule, String sensitivity, Integer daysInARow, Double threshold) {
        RuleConfig d = defaults(rule);
        return new RuleConfig(true, sensitivity != null ? sensitivity : d.sensitivity(), daysInARow != null ? daysInARow : d.days(),
                threshold != null ? threshold : d.threshold(), d.delivery());
    }

    private static Optional<Draft> run(String rule, RuleConfig config, LocalDate on, AlertRules.Days days) {
        return AlertRules.evaluate(AlertCatalog.byId(rule).orElseThrow(), config, on, days, TODAY, ROME);
    }

    private static Optional<Draft> run(String rule, AlertRules.Days days) {
        return run(rule, defaults(rule), TODAY, days);
    }

    // --- catalogue ---

    @Test
    void theCatalogueHasTheNineRulesOfTheAdrWithTheirDefaults() {
        assertThat(AlertCatalog.ALL).extracting(AlertCatalog.Definition::id).containsExactly(
                "fatigue", "temperature", "resting-hr", "hrv", "breathing", "recovery-low", "migraine-risk", "sleep-debt", "steps-low");
        assertThat(AlertCatalog.ALL).extracting(d -> d.defaults().enabled())
                .containsExactly(true, true, true, true, true, true, true, false, false);
        assertThat(AlertCatalog.ALL).extracting(AlertCatalog.Definition::level)
                .containsExactly("alto", "attenzione", "attenzione", "attenzione", "alto", "attenzione", "alto", "attenzione", "attenzione");
        assertThat(defaults("temperature").days()).isEqualTo(2);
        assertThat(defaults("resting-hr").days()).isEqualTo(3);
        assertThat(defaults("hrv").days()).isEqualTo(3);
        assertThat(defaults("recovery-low")).isEqualTo(new RuleConfig(true, null, 3, 70.0, "notifica"));
        assertThat(defaults("sleep-debt")).isEqualTo(new RuleConfig(false, null, null, 6.0, "notifica"));
        assertThat(defaults("steps-low")).isEqualTo(new RuleConfig(false, null, 3, 4000.0, "notifica"));
        assertThat(AlertCatalog.SENSITIVITIES).containsExactly(
                Map.entry("sensibile", 1.5), Map.entry("normale", 2.0), Map.entry("grandi", 2.5));
        assertThat(AlertCatalog.ALL).allMatch(d -> d.defaults().delivery().equals("notifica"));
        assertThat(AlertCatalog.byId("migraine-risk").orElseThrow().pluginId()).isEqualTo("migraine");
        assertThat(AlertCatalog.ALL).extracting(AlertCatalog.Definition::route).containsExactly(
                "/indici/recupero", "/indici/recupero", "/indici/recupero", "/indici/recupero", "/tabs/sonno",
                "/indici/recupero", "/plugin/migraine", "/tabs/sonno", "/indici/movimento");
    }

    // --- fatigue ---

    @Test
    void fatigueFiresOnlyOnTheHighLevel() {
        Draft draft = run("fatigue", days(day(0).metric("strain_level", 2))).orElseThrow();
        assertThat(draft.title()).isEqualTo("Segnali di affaticamento: riposo consigliato");
        assertThat(draft.body()).isEqualTo("Battito a riposo sopra, variabilità del battito (HRV) sotto e temperatura della notte sopra "
                + "la tua media, tutti e tre insieme. Una giornata leggera e una notte di riposo possono aiutare.");
        assertThat(draft.deliverAfter()).isNull();
        assertThat(run("fatigue", days(day(0).metric("strain_level", 1)))).isEmpty();
        assertThat(run("fatigue", days(day(0).metric("strain_level", 0)))).isEmpty();
        // Calibration: no level stored at all.
        assertThat(run("fatigue", days(day(0).feature("resting_hr", 60)))).isEmpty();
        assertThat(run("fatigue", days())).isEmpty();
    }

    // --- temperature ---

    @Test
    void temperatureFiresOnOneNightAtTheSensitivityOrMore() {
        Draft draft = run("temperature", days(day(0).night("temp_night", 34.9, 34.3, 2.1).metric("temp_deviation", 0.6))).orElseThrow();
        assertThat(draft.title()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(draft.body()).isEqualTo("+0,6 °C rispetto alla tua media. Riposo e liquidi possono aiutare.");
        assertThat(draft.values()).containsEntry("streak", 1).containsEntry("strong", true).containsEntry("delta", 0.6);
    }

    @Test
    void temperatureFiresOnTwoNightsInARowAtOneDeviationOrMore() {
        Draft draft = run("temperature", days(
                        day(1).night("temp_night", 34.8, 34.3, 1.1),
                        day(0).night("temp_night", 34.9, 34.3, 1.2).metric("temp_deviation", 0.6)))
                .orElseThrow();
        assertThat(draft.body()).isEqualTo("+0,6 °C rispetto alla tua media, la seconda notte di fila. Riposo e liquidi possono aiutare.");
        assertThat(draft.values()).containsEntry("streak", 2).containsEntry("strong", false);
    }

    @Test
    void temperatureStaysSilentOnOneNightUnderTheSensitivityOrWhenTheRunIsBroken() {
        assertThat(run("temperature", days(day(1).night("temp_night", 34.4, 34.3, 0.5), day(0).night("temp_night", 34.8, 34.3, 1.8)))).isEmpty();
        // A day without data breaks the run.
        assertThat(run("temperature", days(day(2).night("temp_night", 34.8, 34.3, 1.2), day(0).night("temp_night", 34.8, 34.3, 1.2)))).isEmpty();
    }

    @Test
    void theSensitivityMovesTheSingleNightCondition() {
        AlertRules.Days oneNight = days(day(0).night("temp_night", 34.8, 34.3, 1.8).metric("temp_deviation", 0.5));
        assertThat(run("temperature", with("temperature", "normale", null, null), TODAY, oneNight)).isEmpty();
        assertThat(run("temperature", with("temperature", "sensibile", null, null), TODAY, oneNight)).isPresent();

        AlertRules.Days bigger = days(day(0).night("temp_night", 35.0, 34.3, 2.2));
        assertThat(run("temperature", with("temperature", "normale", null, null), TODAY, bigger)).isPresent();
        assertThat(run("temperature", with("temperature", "grandi", null, null), TODAY, bigger)).isEmpty();
    }

    @Test
    void temperatureIsSilentDuringCalibrationEvenAfterHighNights() {
        // Today has the value but no deviation yet: the average is not ready.
        assertThat(run("temperature", days(
                day(2).night("temp_night", 34.9, 34.3, 1.5),
                day(1).night("temp_night", 34.9, 34.3, 1.5),
                day(0).feature("temp_night", 35.5)))).isEmpty();
    }

    // --- resting heart rate ---

    @Test
    void restingHeartRateNeedsThreeNightsInARowAtOneDeviation() {
        Day two = day(2).night("resting_hr", 58, 55, 1.1);
        Day one = day(1).night("resting_hr", 59, 55, 1.4);
        Day zero = day(0).night("resting_hr", 60, 55, 1.6);
        assertThat(run("resting-hr", days(one, zero))).isEmpty();
        Draft draft = run("resting-hr", days(two, one, zero)).orElseThrow();
        assertThat(draft.title()).isEqualTo("Battito a riposo sopra il tuo solito");
        assertThat(draft.body()).isEqualTo(
                "+5 battiti al minuto rispetto alla tua media, la terza notte di fila. Una giornata più leggera e un buon sonno possono aiutare.");
        // The number of nights is a parameter.
        assertThat(run("resting-hr", with("resting-hr", null, 2, null), TODAY, days(one, zero))).isPresent();
    }

    @Test
    void restingHeartRateBelowYourAverageNeverFires() {
        assertThat(run("resting-hr", days(day(0).night("resting_hr", 48, 55, -3)))).isEmpty();
    }

    // --- HRV ---

    @Test
    void hrvFiresBelowYourAverageOnly() {
        Draft draft = run("hrv", days(day(0).night("hrv_night", 38, 50, -2.0))).orElseThrow();
        assertThat(draft.title()).isEqualTo("Variabilità del battito (HRV) sotto il tuo solito");
        assertThat(draft.body()).isEqualTo("−12 millisecondi rispetto alla tua media. Una sera tranquilla e un buon sonno possono aiutare.");
        assertThat(run("hrv", days(day(0).night("hrv_night", 70, 50, 2.5)))).isEmpty();
        assertThat(run("hrv", days(day(0).night("hrv_night", 44, 50, -1.9)))).isEmpty();
        assertThat(run("hrv", days(
                day(2).night("hrv_night", 44, 50, -1.1), day(1).night("hrv_night", 44, 50, -1.0), day(0).night("hrv_night", 44, 50, -1.2))))
                .isPresent();
    }

    // --- breathing ---

    @Test
    void breathingFiresWhenTheNightIsToWatchAndKeepsTheWordingOfTheCard() {
        Day watch = day(0).metric("spo2_night", 94).detail("spo2_night", Map.of("status", "watch", "streak", 3, "deviation", -2.4));
        watch.medians.put("spo2_median", 96.0);
        Draft draft = run("breathing", days(watch)).orElseThrow();
        assertThat(draft.title()).isEqualTo("Ossigeno della notte sotto il tuo solito");
        assertThat(draft.body()).isEqualTo("Ossigeno della notte (SpO2) 94% contro il tuo 96%, la terza notte di fila. "
                + "Non è una diagnosi: se il calo continua, parlane con un medico.");
        assertThat(run("breathing", days(day(0).metric("spo2_night", 96).detail("spo2_night", Map.of("status", "ok", "streak", 0))))).isEmpty();
        assertThat(run("breathing", days(day(0).metric("spo2_night", 96).detail("spo2_night", Map.of("status", "calibrating"))))).isEmpty();
        assertThat(run("breathing", days(day(0).detail("spo2_night", Map.of("status", "insufficient"))))).isEmpty();
    }

    // --- recovery ---

    @Test
    void lowRecoveryNeedsTheDaysInARowUnderTheThreshold() {
        assertThat(run("recovery-low", days(day(1).score("recovery", 65), day(0).score("recovery", 62)))).isEmpty();
        Draft draft = run("recovery-low", days(day(2).score("recovery", 68), day(1).score("recovery", 65), day(0).score("recovery", 62)))
                .orElseThrow();
        assertThat(draft.title()).isEqualTo("Recupero basso da 3 giorni");
        assertThat(draft.body()).isEqualTo("62 su 100, sotto 70 per il terzo giorno di fila. Una giornata più leggera e un buon sonno possono aiutare.");
        Draft longer = run("recovery-low", days(
                        day(3).score("recovery", 60), day(2).score("recovery", 68), day(1).score("recovery", 65), day(0).score("recovery", 62)))
                .orElseThrow();
        assertThat(longer.body()).contains("per il quarto giorno di fila");
        // 70 is not under 70: the run is broken.
        assertThat(run("recovery-low", days(day(2).score("recovery", 70), day(1).score("recovery", 65), day(0).score("recovery", 62)))).isEmpty();
        // A lower threshold.
        assertThat(run("recovery-low", with("recovery-low", null, null, 60.0), TODAY,
                days(day(2).score("recovery", 68), day(1).score("recovery", 65), day(0).score("recovery", 62)))).isEmpty();
        // One day is enough when the user asks for it.
        Draft single = run("recovery-low", with("recovery-low", null, 1, null), TODAY, days(day(0).score("recovery", 62))).orElseThrow();
        assertThat(single.title()).isEqualTo("Recupero basso");
        assertThat(single.body()).isEqualTo("62 su 100, sotto 70. Una giornata più leggera e un buon sonno possono aiutare.");
    }

    // --- sleep debt ---

    @Test
    void sleepDebtFiresOverTheThresholdAndIsDeliveredAfterNinePmLocal() {
        Draft draft = run("sleep-debt", with("sleep-debt", null, null, null), TODAY, days(day(0).metric("sleep_debt", 7.5))).orElseThrow();
        assertThat(draft.title()).isEqualTo("Debito di sonno oltre 6 ore");
        assertThat(draft.body()).isEqualTo("7,5 ore negli ultimi 7 giorni. Stasera andare a letto un po' prima può aiutare.");
        // 21:00 in Rome on 14 November is 20:00 UTC.
        assertThat(draft.deliverAfter()).isEqualTo(Instant.parse("2026-11-14T20:00:00Z").toEpochMilli());
        assertThat(run("sleep-debt", with("sleep-debt", null, null, null), TODAY, days(day(0).metric("sleep_debt", 6.0)))).isEmpty();
        Draft custom = run("sleep-debt", with("sleep-debt", null, null, 5.5), TODAY, days(day(0).metric("sleep_debt", 6.0))).orElseThrow();
        assertThat(custom.title()).isEqualTo("Debito di sonno oltre 5,5 ore");
        assertThat(run("sleep-debt", with("sleep-debt", null, null, null), TODAY, days(day(0).score("sleep", 80)))).isEmpty();
    }

    // --- steps ---

    @Test
    void lowStepsLooksOnlyAtFinishedDays() {
        AlertRules.Days low = days(
                day(3).feature("steps", 3900), day(2).feature("steps", 3000), day(1).feature("steps", 2850), day(0).feature("steps", 500));
        // Today is still in progress: never.
        assertThat(run("steps-low", with("steps-low", null, null, null), TODAY, low)).isEmpty();
        Draft draft = run("steps-low", with("steps-low", null, null, null), TODAY.minusDays(1), low).orElseThrow();
        assertThat(draft.title()).isEqualTo("Pochi passi da 3 giorni");
        assertThat(draft.body()).isEqualTo("2.850 passi, sotto 4.000 per il terzo giorno di fila. Una breve passeggiata può aiutare.");
        AlertRules.Days broken = days(day(3).feature("steps", 4000), day(2).feature("steps", 3000), day(1).feature("steps", 2850));
        assertThat(run("steps-low", with("steps-low", null, null, null), TODAY.minusDays(1), broken)).isEmpty();
    }

    // --- texts ---

    @Test
    void numbersAreWrittenTheItalianWay() {
        assertThat(AlertText.signed(0.6, 1)).isEqualTo("+0,6");
        assertThat(AlertText.signed(-12.3, 0)).isEqualTo("−12");
        assertThat(AlertText.signed(0.02, 1)).isEqualTo("0");
        assertThat(AlertText.decimal(94.5, 1)).isEqualTo("94,5");
        assertThat(AlertText.decimal(7.0, 1)).isEqualTo("7");
        assertThat(AlertText.decimal(-0.25, 2)).isEqualTo("−0,25");
        assertThat(AlertText.thousands(4000)).isEqualTo("4.000");
        assertThat(AlertText.thousands(850)).isEqualTo("850");
        assertThat(List.of(AlertText.nightsInARow(2), AlertText.nightsInARow(8), AlertText.nightsInARow(12)))
                .containsExactly("la seconda notte di fila", "l'ottava notte di fila", "da 12 notti di fila");
        assertThat(List.of(AlertText.daysInARow(3), AlertText.daysInARow(8), AlertText.daysInARow(11)))
                .containsExactly("per il terzo giorno di fila", "per l'ottavo giorno di fila", "da 11 giorni di fila");
    }

    @Test
    void theStreakCountsConsecutiveDaysEndingOnTheDay() {
        AlertRules.Days run = days(day(3).score("recovery", 50), day(1).score("recovery", 50), day(0).score("recovery", 50));
        assertThat(AlertRules.streak(TODAY, run, r -> r.scores().get("recovery") != null)).isEqualTo(2);
        assertThat(AlertRules.streak(TODAY.minusDays(2), run, r -> true)).isZero();
    }
}
