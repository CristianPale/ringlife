package com.ringlife.backend.alert;

import static com.ringlife.backend.alert.AlertText.decimal;
import static com.ringlife.backend.alert.AlertText.thousands;

import java.util.List;
import java.util.Optional;
import java.util.function.Function;

import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.History.DayResults;

/**
 * Your own alert rules (ADR 0046): the measures a rule can watch, the comparisons, the allowed values and the name the
 * server writes from the rule. A rule is measure × comparison × amount × days in a row × level × delivery. No free
 * names: a name would end up in the notifications.
 */
final class CustomCatalog {

    private CustomCatalog() {}

    /** At most this many rules per device. */
    static final int MAX_RULES = 20;

    static final String ABOVE_AVERAGE = "above_average";
    static final String BELOW_AVERAGE = "below_average";
    static final String ABOVE = "above";
    static final String BELOW = "below";
    static final List<String> COMPARISONS = List.of(ABOVE_AVERAGE, BELOW_AVERAGE, ABOVE, BELOW);

    static final List<String> LEVELS = List.of(AlertCatalog.ATTENTION, AlertCatalog.HIGH);

    /** «N days in a row»: 1-7. */
    static final AlertCatalog.DaysRange DAYS = new AlertCatalog.DaysRange(1, 7);

    /** N deviations from your average for the comparisons with it. */
    static final ValueRange DEVIATIONS = new ValueRange(1, 3, 0.5);

    /** Id prefix: `custom-` and 8 hexadecimal characters. */
    static final String ID_PREFIX = "custom-";

    /** Allowed values of an amount, in the measure's unit, with the step the app offers. */
    record ValueRange(double min, double max, double step) {

        /** Inside the range and on a step from `min` (with a tolerance for binary fractions). */
        boolean accepts(double value) {
            if (!Double.isFinite(value) || value < min - 1e-9 || value > max + 1e-9) {
                return false;
            }
            double steps = (value - min) / step;
            return Math.abs(steps - Math.rint(steps)) < 1e-6;
        }
    }

    /**
     * A measure. `unit` is null when the value has no unit to show. `night` measures belong to the night that ends on
     * the day (evaluated only when that night is over, `FinishedNights`), the others to a whole day (evaluated only on
     * finished days, never today). `average`: it can be compared with your average. `value`: the range of a value
     * comparison, or null when only your average makes sense. `unitSuffix` follows the amount in the rule name;
     * `valueText` says the value of a day in the event body, `differenceText` its difference from your median.
     */
    record Metric(
            String id,
            String name,
            String unit,
            boolean night,
            boolean average,
            ValueRange value,
            String route,
            Function<DayResults, Double> reader,
            String feature,
            String unitSuffix,
            Function<Double, String> amountText,
            Function<Double, String> valueText,
            Function<Double, String> differenceText) {

        /** The value of the day in the measure's unit, or null. */
        Double valueOf(DayResults results) {
            return results == null ? null : reader.apply(results);
        }

        /** The deviation of the day from your average, or null (no average for the measure, or calibration). */
        Double deviationOf(DayResults results) {
            return results == null || feature == null ? null : results.deviations().get(feature);
        }

        boolean allows(String comparison) {
            return switch (comparison) {
                case ABOVE_AVERAGE, BELOW_AVERAGE -> average;
                case ABOVE, BELOW -> value != null;
                default -> false;
            };
        }
    }

    private static final String RECOVERY_PAGE = "/indici/recupero";
    private static final String SLEEP_PAGE = "/tabs/sonno";
    private static final String MOVEMENT_PAGE = "/indici/movimento";
    private static final String STRESS_PAGE = "/indici/stress";

    static final List<Metric> METRICS = List.of(
            new Metric("resting_hr", "Battito a riposo", "battiti al minuto", true, true, new ValueRange(30, 120, 1), RECOVERY_PAGE,
                    r -> r.features().get(Features.RESTING_HR), Features.RESTING_HR, " battiti al minuto",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " battiti al minuto",
                    d -> AlertText.signed(d, 0) + " battiti al minuto"),
            new Metric("hrv", "Variabilità del battito (HRV)", "ms", true, true, new ValueRange(5, 200, 1), RECOVERY_PAGE,
                    r -> r.features().get(Features.HRV_NIGHT), Features.HRV_NIGHT, " ms",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " millisecondi",
                    d -> AlertText.signed(d, 0) + " millisecondi"),
            new Metric("temperature", "Temperatura della notte", null, true, true, null, RECOVERY_PAGE,
                    r -> r.features().get(Features.TEMP_NIGHT), Features.TEMP_NIGHT, "",
                    a -> decimal(a, 1), v -> decimal(v, 1) + " °C",
                    d -> AlertText.signed(d, 1) + " °C"),
            new Metric("spo2", "Ossigeno della notte (SpO2)", null, true, true, null, SLEEP_PAGE,
                    r -> r.features().get(Features.SPO2_MEDIAN), Features.SPO2_MEDIAN, "",
                    a -> decimal(a, 1), v -> decimal(v, 1) + "%",
                    d -> AlertText.signed(d, 1) + " punti percentuali"),
            new Metric("sleep_hours", "Ore di sonno", "h", true, false, new ValueRange(2, 12, 0.5), SLEEP_PAGE,
                    r -> r.features().get(Features.ASLEEP_MIN) == null ? null : r.features().get(Features.ASLEEP_MIN) / 60.0, null, "",
                    a -> decimal(a, 1), v -> decimal(v, 1) + " ore di sonno", null),
            new Metric("sleep_debt", "Debito di sonno", "h", true, false, new ValueRange(1, 20, 0.5), SLEEP_PAGE,
                    r -> r.metrics().get("sleep_debt"), null, " ore",
                    a -> decimal(a, 1), v -> decimal(v, 1) + " ore di debito di sonno", null),
            new Metric("sleep_score", "Indice Sonno", "punti", true, false, new ValueRange(0, 100, 1), SLEEP_PAGE,
                    r -> score(r, "sleep"), null, "",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " su 100", null),
            new Metric("recovery_score", "Recupero", "punti", true, false, new ValueRange(0, 100, 1), RECOVERY_PAGE,
                    r -> score(r, "recovery"), null, "",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " su 100", null),
            new Metric("stress_score", "Stress", "punti", false, false, new ValueRange(0, 100, 1), STRESS_PAGE,
                    r -> score(r, "stress"), null, "",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " su 100", null),
            new Metric("movement_score", "Movimento", "punti", false, false, new ValueRange(0, 100, 1), MOVEMENT_PAGE,
                    r -> score(r, "movement"), null, "",
                    a -> decimal(a, 0), v -> decimal(v, 0) + " su 100", null),
            new Metric("steps", "Passi", "passi", false, false, new ValueRange(500, 30000, 500), MOVEMENT_PAGE,
                    r -> r.features().get(Features.STEPS), null, "",
                    a -> thousands(a), v -> thousands(v) + " passi", null));

    static Optional<Metric> metric(String id) {
        return METRICS.stream().filter(m -> m.id().equals(id)).findFirst();
    }

    /** A rule of the user, as stored. `amount`: N deviations with your average, the value in the measure's unit otherwise. */
    record Rule(
            String id,
            String metric,
            String comparison,
            double amount,
            int days,
            String level,
            String delivery,
            boolean enabled) {}

    static boolean withAverage(String comparison) {
        return ABOVE_AVERAGE.equals(comparison) || BELOW_AVERAGE.equals(comparison);
    }

    static boolean upwards(String comparison) {
        return ABOVE_AVERAGE.equals(comparison) || ABOVE.equals(comparison);
    }

    /**
     * The name the server writes from the rule (ADR 0046), also shown by the app as a live preview: «Passi sotto 3.000»,
     * «Debito di sonno sopra 6,5 ore», «Battito a riposo sopra la tua media di 1,5 scostamenti», then « per N notti di
     * fila» (night measures) or « per N giorni di fila» only when N is more than 1.
     */
    static String name(Rule rule) {
        Metric metric = metric(rule.metric()).orElseThrow();
        StringBuilder name = new StringBuilder(metric.name()).append(upwards(rule.comparison()) ? " sopra " : " sotto ");
        if (withAverage(rule.comparison())) {
            name.append("la tua media di ").append(decimal(rule.amount(), 1))
                    .append(rule.amount() == 1.0 ? " scostamento" : " scostamenti");
        } else {
            name.append(metric.amountText().apply(rule.amount())).append(metric.unitSuffix());
        }
        if (rule.days() > 1) {
            name.append(" per ").append(rule.days()).append(metric.night() ? " notti di fila" : " giorni di fila");
        }
        return name.toString();
    }

    private static Double score(DayResults results, String kind) {
        Integer value = results.scores().get(kind);
        return value == null ? null : value.doubleValue();
    }
}
