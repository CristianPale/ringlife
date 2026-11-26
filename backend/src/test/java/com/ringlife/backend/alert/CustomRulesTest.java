package com.ringlife.backend.alert;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.alert.AlertRules.Draft;
import com.ringlife.backend.alert.CustomCatalog.Metric;
import com.ringlife.backend.alert.CustomCatalog.Rule;
import com.ringlife.backend.compute.History.DayResults;

/** Your own alert rules (ADR 0046) on synthetic days: catalogue, names, conditions, streaks, texts. No real value. */
class CustomRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);

    /** A synthetic day, built field by field. */
    private static final class Day {
        final LocalDate date;
        final Map<String, Integer> scores = new HashMap<>();
        final Map<String, Double> metrics = new HashMap<>();
        final Map<String, Double> features = new HashMap<>();
        final Map<String, Double> deviations = new HashMap<>();
        final Map<String, Double> medians = new HashMap<>();

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

        Day feature(String name, double value) {
            features.put(name, value);
            return this;
        }

        /** A feature with your median and the deviation from it. */
        Day average(String feature, double value, double median, double deviation) {
            features.put(feature, value);
            medians.put(feature, median);
            deviations.put(feature, deviation);
            return this;
        }

        DayResults build() {
            return new DayResults(date, scores, metrics, features, deviations, medians, Map.of());
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

    private static Rule rule(String metric, String comparison, double amount, int days) {
        return new Rule("custom-0000abcd", metric, comparison, amount, days, "attenzione", "notifica", true);
    }

    private static Optional<Draft> run(Rule rule, int daysAgo, AlertRules.Days days) {
        return CustomRules.evaluate(rule, TODAY.minusDays(daysAgo), days, TODAY);
    }

    // --- catalogue and names ---

    @Test
    void theCatalogueIsTheTableOfTheAdr() {
        assertThat(CustomCatalog.METRICS).extracting(Metric::id).containsExactly(
                "resting_hr", "hrv", "temperature", "spo2", "sleep_hours", "sleep_debt", "sleep_score", "recovery_score",
                "stress_score", "movement_score", "steps");
        assertThat(CustomCatalog.METRICS).extracting(Metric::name).containsExactly(
                "Battito a riposo", "Variabilità del battito (HRV)", "Temperatura della notte", "Ossigeno della notte (SpO2)",
                "Ore di sonno", "Debito di sonno", "Indice Sonno", "Recupero", "Stress", "Movimento", "Passi");
        assertThat(CustomCatalog.METRICS).extracting(Metric::night)
                .containsExactly(true, true, true, true, true, true, true, true, false, false, false);
        assertThat(CustomCatalog.METRICS).extracting(Metric::average)
                .containsExactly(true, true, true, true, false, false, false, false, false, false, false);
        assertThat(CustomCatalog.metric("temperature").orElseThrow().value()).isNull();
        assertThat(CustomCatalog.metric("spo2").orElseThrow().value()).isNull();
        assertThat(CustomCatalog.metric("resting_hr").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(30, 120, 1));
        assertThat(CustomCatalog.metric("hrv").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(5, 200, 1));
        assertThat(CustomCatalog.metric("sleep_hours").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(2, 12, 0.5));
        assertThat(CustomCatalog.metric("sleep_debt").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(1, 20, 0.5));
        assertThat(CustomCatalog.metric("steps").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(500, 30000, 500));
        assertThat(CustomCatalog.metric("stress_score").orElseThrow().value()).isEqualTo(new CustomCatalog.ValueRange(0, 100, 1));
        assertThat(CustomCatalog.MAX_RULES).isEqualTo(20);
    }

    @Test
    void theComparisonsFollowTheMeasure() {
        Metric temperature = CustomCatalog.metric("temperature").orElseThrow();
        assertThat(temperature.allows("above_average")).isTrue();
        assertThat(temperature.allows("above")).isFalse();
        assertThat(CustomCatalog.metric("spo2").orElseThrow().allows("below")).isFalse();
        assertThat(CustomCatalog.metric("steps").orElseThrow().allows("below_average")).isFalse();
        assertThat(CustomCatalog.metric("resting_hr").orElseThrow().allows("above")).isTrue();
        assertThat(CustomCatalog.metric("resting_hr").orElseThrow().allows("above_average")).isTrue();
    }

    @Test
    void valuesMustBeInRangeAndOnAStep() {
        CustomCatalog.ValueRange steps = CustomCatalog.metric("steps").orElseThrow().value();
        assertThat(steps.accepts(3000)).isTrue();
        assertThat(steps.accepts(3100)).isFalse();
        assertThat(steps.accepts(0)).isFalse();
        assertThat(steps.accepts(30500)).isFalse();
        assertThat(CustomCatalog.DEVIATIONS.accepts(1.5)).isTrue();
        assertThat(CustomCatalog.DEVIATIONS.accepts(1.25)).isFalse();
        assertThat(CustomCatalog.DEVIATIONS.accepts(3.5)).isFalse();
        assertThat(CustomCatalog.metric("sleep_hours").orElseThrow().value().accepts(6.5)).isTrue();
        assertThat(CustomCatalog.metric("sleep_hours").orElseThrow().value().accepts(Double.NaN)).isFalse();
    }

    @Test
    void theNameIsWrittenFromTheRule() {
        assertThat(CustomCatalog.name(rule("steps", "below", 3000, 1))).isEqualTo("Passi sotto 3.000");
        assertThat(CustomCatalog.name(rule("steps", "below", 3000, 3))).isEqualTo("Passi sotto 3.000 per 3 giorni di fila");
        assertThat(CustomCatalog.name(rule("sleep_hours", "below", 6, 1))).isEqualTo("Ore di sonno sotto 6");
        assertThat(CustomCatalog.name(rule("sleep_hours", "below", 6, 2))).isEqualTo("Ore di sonno sotto 6 per 2 notti di fila");
        assertThat(CustomCatalog.name(rule("sleep_debt", "above", 6.5, 1))).isEqualTo("Debito di sonno sopra 6,5 ore");
        assertThat(CustomCatalog.name(rule("recovery_score", "below", 60, 1))).isEqualTo("Recupero sotto 60");
        assertThat(CustomCatalog.name(rule("sleep_score", "below", 60, 1))).isEqualTo("Indice Sonno sotto 60");
        assertThat(CustomCatalog.name(rule("resting_hr", "above", 70, 1))).isEqualTo("Battito a riposo sopra 70 battiti al minuto");
        assertThat(CustomCatalog.name(rule("hrv", "below", 25, 1))).isEqualTo("Variabilità del battito (HRV) sotto 25 ms");
        assertThat(CustomCatalog.name(rule("steps", "above", 12000, 1))).isEqualTo("Passi sopra 12.000");
        assertThat(CustomCatalog.name(rule("resting_hr", "above_average", 1.5, 2)))
                .isEqualTo("Battito a riposo sopra la tua media di 1,5 scostamenti per 2 notti di fila");
        assertThat(CustomCatalog.name(rule("hrv", "below_average", 1, 1)))
                .isEqualTo("Variabilità del battito (HRV) sotto la tua media di 1 scostamento");
        assertThat(CustomCatalog.name(rule("temperature", "above_average", 2, 1)))
                .isEqualTo("Temperatura della notte sopra la tua media di 2 scostamenti");
        assertThat(CustomCatalog.name(rule("stress_score", "above", 70, 2))).isEqualTo("Stress sopra 70 per 2 giorni di fila");
    }

    // --- conditions ---

    @Test
    void aValueBelowTheAmountFiresAndTheTitleSaysTheProblem() {
        Rule steps = rule("steps", "below", 3000, 3);
        AlertRules.Days days = days(
                day(1).feature("steps", 2400), day(2).feature("steps", 2900), day(3).feature("steps", 1000), day(4).feature("steps", 5000));
        Draft draft = run(steps, 1, days).orElseThrow();
        assertThat(draft.title()).isEqualTo("Passi sotto 3.000 da 3 giorni");
        assertThat(draft.body()).isEqualTo("2.400 passi, sotto 3.000 per il terzo giorno di fila. Avviso creato da te.");
        assertThat(draft.deliverAfter()).isNull();
        assertThat(draft.values()).containsEntry("metric", "steps").containsEntry("streak", 3).containsEntry("value", 2400.0);
        // Two days earlier the run had only two days.
        assertThat(run(steps, 2, days)).isEmpty();
        // Exactly the amount is not below it.
        assertThat(run(rule("steps", "below", 2400, 1), 1, days)).isEmpty();
    }

    @Test
    void aValueAboveTheAmountFires() {
        Rule debt = rule("sleep_debt", "above", 6, 1);
        Draft draft = run(debt, 0, days(day(0).metric("sleep_debt", 7.5))).orElseThrow();
        assertThat(draft.title()).isEqualTo("Debito di sonno sopra 6 ore");
        assertThat(draft.body()).isEqualTo("7,5 ore di debito di sonno, sopra 6. Avviso creato da te.");
        assertThat(run(debt, 0, days(day(0).metric("sleep_debt", 6)))).isEmpty();
        assertThat(run(debt, 0, days(day(0)))).isEmpty();

        Draft heart = run(rule("resting_hr", "above", 60, 2), 0,
                days(day(0).feature("resting_hr", 64), day(1).feature("resting_hr", 61))).orElseThrow();
        assertThat(heart.title()).isEqualTo("Battito a riposo sopra 60 battiti al minuto da 2 notti");
        assertThat(heart.body()).isEqualTo("64 battiti al minuto, sopra 60, la seconda notte di fila. Avviso creato da te.");
    }

    @Test
    void sleepHoursComeFromTheMinutesAsleepAndScoresFromTheIndices() {
        Draft sleep = run(rule("sleep_hours", "below", 6, 1), 0, days(day(0).feature("sleep_asleep_min", 330))).orElseThrow();
        assertThat(sleep.title()).isEqualTo("Ore di sonno sotto 6");
        assertThat(sleep.body()).isEqualTo("5,5 ore di sonno, sotto 6. Avviso creato da te.");

        Draft recovery = run(rule("recovery_score", "below", 60, 1), 0, days(day(0).score("recovery", 52))).orElseThrow();
        assertThat(recovery.title()).isEqualTo("Recupero sotto 60");
        assertThat(recovery.body()).isEqualTo("52 su 100, sotto 60. Avviso creato da te.");
        assertThat(run(rule("sleep_score", "below", 60, 1), 0, days(day(0).score("sleep", 59)))).isPresent();
        assertThat(run(rule("sleep_score", "below", 60, 1), 0, days(day(0).score("recovery", 10)))).isEmpty();
        assertThat(run(rule("stress_score", "above", 70, 1), 1, days(day(1).score("stress", 75)))).isPresent();
        assertThat(run(rule("movement_score", "below", 40, 1), 1, days(day(1).score("movement", 30)))).isPresent();
    }

    @Test
    void aComparisonWithYourAverageCountsDeviations() {
        Rule above = rule("resting_hr", "above_average", 1.5, 2);
        AlertRules.Days days = days(day(0).average("resting_hr", 62, 56, 1.8), day(1).average("resting_hr", 61, 56, 1.5),
                day(2).average("resting_hr", 57, 56, 0.4));
        Draft draft = run(above, 0, days).orElseThrow();
        assertThat(draft.title()).isEqualTo("Battito a riposo sopra il tuo solito da 2 notti");
        assertThat(draft.body()).isEqualTo("+6 battiti al minuto rispetto alla tua media, la seconda notte di fila. Avviso creato da te.");
        assertThat(draft.values()).containsEntry("deviation", 1.8).containsEntry("difference", 6.0);
        // One night only: not enough for 2 in a row.
        assertThat(run(above, 1, days)).isEmpty();

        Rule below = rule("hrv", "below_average", 1, 1);
        Draft hrv = run(below, 0, days(day(0).average("hrv_night", 31, 42, -1.2))).orElseThrow();
        assertThat(hrv.title()).isEqualTo("Variabilità del battito (HRV) sotto il tuo solito");
        assertThat(hrv.body()).isEqualTo("−11 millisecondi rispetto alla tua media. Avviso creato da te.");
        assertThat(run(below, 0, days(day(0).average("hrv_night", 40, 42, -0.9)))).isEmpty();
        // Above your average is not below it.
        assertThat(run(below, 0, days(day(0).average("hrv_night", 60, 42, 2.5)))).isEmpty();
    }

    @Test
    void temperatureAndOxygenSpeakOfTheirDifference() {
        Draft warm = run(rule("temperature", "above_average", 1, 1), 0,
                days(day(0).average("temp_night", 34.9, 34.3, 1.2).metric("temp_deviation", 0.6))).orElseThrow();
        assertThat(warm.title()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(warm.body()).isEqualTo("+0,6 °C rispetto alla tua media. Avviso creato da te.");
        Draft oxygen = run(rule("spo2", "below_average", 2, 1), 0,
                days(day(0).average("spo2_median", 94, 96.5, -2.4))).orElseThrow();
        assertThat(oxygen.body()).isEqualTo("−2,5 punti percentuali rispetto alla tua media. Avviso creato da te.");
    }

    @Test
    void withYourAverageTheRuleIsSilentDuringCalibration() {
        Rule above = rule("resting_hr", "above_average", 1, 1);
        // A value, but no deviation yet: calibration.
        assertThat(run(above, 0, days(day(0).feature("resting_hr", 90)))).isEmpty();
        // A value comparison on the same day works without your average.
        assertThat(run(rule("resting_hr", "above", 80, 1), 0, days(day(0).feature("resting_hr", 90)))).isPresent();
    }

    @Test
    void aDayWithoutDataBreaksTheRun() {
        Rule steps = rule("steps", "below", 3000, 3);
        AlertRules.Days days = days(day(1).feature("steps", 2000), day(2).feature("steps", 2000), day(4).feature("steps", 2000));
        assertThat(run(steps, 1, days)).isEmpty();
        assertThat(run(rule("steps", "below", 3000, 2), 1, days)).isPresent();
    }

    @Test
    void measuresOfAWholeDayNeverLookAtToday() {
        AlertRules.Days days = days(day(0).feature("steps", 100).score("stress", 90).score("movement", 5),
                day(1).feature("steps", 100).score("stress", 90).score("movement", 5));
        assertThat(run(rule("steps", "below", 3000, 1), 0, days)).isEmpty();
        assertThat(run(rule("stress_score", "above", 70, 1), 0, days)).isEmpty();
        assertThat(run(rule("movement_score", "below", 40, 1), 0, days)).isEmpty();
        assertThat(run(rule("steps", "below", 3000, 1), 1, days)).isPresent();
        Draft stress = run(rule("stress_score", "above", 70, 1), 1, days).orElseThrow();
        assertThat(stress.title()).isEqualTo("Stress sopra 70");
        // Night measures look at today: the gate on finished nights is the caller's.
        assertThat(run(rule("sleep_hours", "below", 6, 1), 0, days(day(0).feature("sleep_asleep_min", 200)))).isPresent();
    }

    @Test
    void aMeasureOrComparisonOutsideTheCatalogueRaisesNothing() {
        AlertRules.Days days = days(day(0).feature("steps", 100).average("temp_night", 36, 34, 3));
        assertThat(run(rule("calorie", "below", 1, 1), 0, days)).isEmpty();
        assertThat(run(rule("temperature", "above", 30, 1), 0, days)).isEmpty();
    }

    @Test
    void longerRunsSayTheirLength() {
        Rule steps = rule("steps", "below", 3000, 1);
        AlertRules.Days days = days(day(1).feature("steps", 2000), day(2).feature("steps", 2000), day(3).feature("steps", 2000),
                day(4).feature("steps", 2000), day(5).feature("steps", 2000), day(6).feature("steps", 2000),
                day(7).feature("steps", 2000), day(8).feature("steps", 2000), day(9).feature("steps", 2000),
                day(10).feature("steps", 2000), day(11).feature("steps", 2000), day(12).feature("steps", 2000));
        Draft draft = run(steps, 1, days).orElseThrow();
        assertThat(draft.title()).isEqualTo("Passi sotto 3.000 da 12 giorni");
        assertThat(draft.body()).isEqualTo("2.000 passi, sotto 3.000 da 12 giorni di fila. Avviso creato da te.");
        assertThat(run(steps, 12, days).orElseThrow().title()).isEqualTo("Passi sotto 3.000");
    }
}
