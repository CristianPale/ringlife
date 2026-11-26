package com.ringlife.backend.alert;

import static com.ringlife.backend.alert.AlertText.daysInARow;
import static com.ringlife.backend.alert.AlertText.nightsInARow;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;

import com.ringlife.backend.alert.CustomCatalog.Metric;
import com.ringlife.backend.alert.CustomCatalog.Rule;
import com.ringlife.backend.compute.History.DayResults;

/**
 * The condition of a rule of yours (ADR 0046), as a pure function of the day results already computed, like the
 * built-in rules: no new formula. «N days in a row» means N consecutive days ending on the evaluated day, each meeting
 * the condition ({@link AlertRules#streak}). A comparison with your average is silent while the deviation is missing
 * (calibration). Measures of a whole day (steps, Stress, Movement) never look at today, still in progress; the gate on
 * finished nights is applied by the caller, as for the built-in rules.
 */
final class CustomRules {

    private CustomRules() {}

    static final String SIGNATURE = "Avviso creato da te.";

    /** Version of the evaluation of your rules, stored with each event like the version of a built-in rule. */
    static final String VERSION = "1";

    /** Evaluates a rule on a day; empty for a measure no longer in the catalogue. `today` is the current local day. */
    static Optional<AlertRules.Draft> evaluate(Rule rule, LocalDate day, AlertRules.Days days, LocalDate today) {
        Optional<Metric> found = CustomCatalog.metric(rule.metric());
        if (found.isEmpty() || !found.get().allows(rule.comparison())) {
            return Optional.empty();
        }
        Metric metric = found.get();
        if (!metric.night() && !day.isBefore(today)) {
            return Optional.empty();
        }
        Predicate<DayResults> condition = condition(rule, metric);
        DayResults results = days.get(day);
        if (results == null || !condition.test(results)) {
            return Optional.empty();
        }
        int streak = AlertRules.streak(day, days, condition);
        if (streak < rule.days()) {
            return Optional.empty();
        }
        return Optional.of(draft(rule, metric, results, streak));
    }

    /** Whether a day meets the rule. With your average: at least N deviations, never without a deviation. */
    static Predicate<DayResults> condition(Rule rule, Metric metric) {
        double amount = rule.amount();
        return switch (rule.comparison()) {
            case CustomCatalog.ABOVE_AVERAGE -> r -> {
                Double d = metric.deviationOf(r);
                return d != null && d >= amount;
            };
            case CustomCatalog.BELOW_AVERAGE -> r -> {
                Double d = metric.deviationOf(r);
                return d != null && d <= -amount;
            };
            case CustomCatalog.ABOVE -> r -> {
                Double v = metric.valueOf(r);
                return v != null && v > amount;
            };
            case CustomCatalog.BELOW -> r -> {
                Double v = metric.valueOf(r);
                return v != null && v < amount;
            };
            default -> r -> false;
        };
    }

    /**
     * Title with the problem («Passi sotto 3.000 da 3 giorni», «Battito a riposo sopra il tuo solito da 2 notti»), body
     * with the value of the day and the run, ending with «Avviso creato da te.».
     */
    private static AlertRules.Draft draft(Rule rule, Metric metric, DayResults results, int streak) {
        boolean up = CustomCatalog.upwards(rule.comparison());
        boolean average = CustomCatalog.withAverage(rule.comparison());
        Double value = metric.valueOf(results);
        String unitOfRun = metric.night() ? " notti" : " giorni";

        StringBuilder title = new StringBuilder(metric.name()).append(up ? " sopra " : " sotto ");
        if (average) {
            title.append("il tuo solito");
        } else {
            title.append(metric.amountText().apply(rule.amount())).append(metric.unitSuffix());
        }
        if (streak >= 2) {
            title.append(" da ").append(streak).append(unitOfRun);
        }

        StringBuilder body = new StringBuilder();
        Double difference = null;
        Double median = results.medians().get(metric.feature() == null ? "" : metric.feature());
        if (average) {
            difference = difference(metric, results, value, median);
            body.append(difference == null
                    ? (up ? "Sopra la tua media" : "Sotto la tua media")
                    : metric.differenceText().apply(difference) + " rispetto alla tua media");
        } else {
            body.append(metric.valueText().apply(value)).append(up ? ", sopra " : ", sotto ")
                    .append(metric.amountText().apply(rule.amount()));
        }
        if (streak >= 2) {
            body.append(metric.night() ? ", " + nightsInARow(streak) : " " + daysInARow(streak));
        }
        body.append(". ").append(SIGNATURE);

        Map<String, Object> values = new LinkedHashMap<>();
        values.put("metric", rule.metric());
        values.put("comparison", rule.comparison());
        values.put("amount", rule.amount());
        values.put("days", rule.days());
        values.put("streak", streak);
        if (value != null) {
            values.put("value", round(value, 2));
        }
        if (average) {
            values.put("deviation", round(metric.deviationOf(results), 2));
            if (difference != null) {
                values.put("difference", round(difference, 2));
            }
        }
        return new AlertRules.Draft(title.toString(), body.toString(), values, null);
    }

    /** Value minus your median; for the temperature the stored night deviation in °C when there is one. */
    private static Double difference(Metric metric, DayResults results, Double value, Double median) {
        if ("temperature".equals(metric.id()) && results.metrics().get("temp_deviation") != null) {
            return results.metrics().get("temp_deviation");
        }
        return value == null || median == null ? null : value - median;
    }

    private static double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }
}
