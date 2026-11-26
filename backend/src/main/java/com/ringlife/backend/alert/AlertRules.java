package com.ringlife.backend.alert;

import static com.ringlife.backend.alert.AlertText.daysInARow;
import static com.ringlife.backend.alert.AlertText.decimal;
import static com.ringlife.backend.alert.AlertText.nightsInARow;
import static com.ringlife.backend.alert.AlertText.signed;
import static com.ringlife.backend.alert.AlertText.thousands;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;

import com.ringlife.backend.alert.AlertCatalog.Definition;
import com.ringlife.backend.alert.AlertCatalog.RuleConfig;
import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.History.DayResults;
import com.ringlife.backend.score.NightBreathing;
import com.ringlife.backend.score.StrainSignals;

/**
 * The conditions of the built-in rules (ADR 0045), as pure functions of the day results already computed. A rule on
 * your average is silent while the deviation of the day is missing (calibration). «N nights in a row» means N
 * consecutive days ending on the evaluated day, each with the weaker condition (at least one deviation); the strong
 * condition (at least S deviations) fires on a single day. Texts are short, neutral, never a diagnosis.
 */
final class AlertRules {

    private AlertRules() {}

    /** What an event will say: level, page and delivery come from the rule. `deliverAfter` in ms UTC, or null. */
    record Draft(String title, String body, Map<String, Object> values, Long deliverAfter) {}

    /** The results of the device by day; days without results are missing. */
    interface Days {
        DayResults get(LocalDate day);
    }

    /**
     * Evaluates a rule on a day. `today` is the current local day (the steps rule looks only at finished days), `zone`
     * the presentation zone (the sleep debt is delivered after 21:00 of that day). Rules fed by a plugin are not
     * evaluated here.
     */
    static Optional<Draft> evaluate(Definition rule, RuleConfig config, LocalDate day, Days days, LocalDate today, ZoneId zone) {
        return switch (rule.id()) {
            case AlertCatalog.FATIGUE -> fatigue(day, days);
            case AlertCatalog.TEMPERATURE -> temperature(config, day, days);
            case AlertCatalog.RESTING_HR -> restingHr(config, day, days);
            case AlertCatalog.HRV -> hrv(config, day, days);
            case AlertCatalog.BREATHING -> breathing(day, days);
            case AlertCatalog.RECOVERY_LOW -> recoveryLow(config, day, days);
            case AlertCatalog.SLEEP_DEBT -> sleepDebt(config, day, days, zone);
            case AlertCatalog.STEPS_LOW -> stepsLow(config, day, days, today);
            default -> Optional.empty();
        };
    }

    // --- rules on your average ---

    /** Level «alto» of the fatigue signals: the stored `strain_level` is the ordinal of {@link StrainSignals.Level}. */
    static Optional<Draft> fatigue(LocalDate day, Days days) {
        DayResults results = days.get(day);
        Double level = results == null ? null : results.metrics().get("strain_level");
        if (level == null || level.intValue() != StrainSignals.Level.HIGH.ordinal()) {
            return Optional.empty();
        }
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("level", "high");
        putDeviation(values, "restingHrDeviation", results, Features.RESTING_HR);
        putDeviation(values, "hrvDeviation", results, Features.HRV_NIGHT);
        putDeviation(values, "temperatureDeviation", results, Features.TEMP_NIGHT);
        return Optional.of(new Draft(
                "Segnali di affaticamento: riposo consigliato",
                "Battito a riposo sopra, variabilità del battito (HRV) sotto e temperatura della notte sopra la tua media, "
                        + "tutti e tre insieme. Una giornata leggera e una notte di riposo possono aiutare.",
                values,
                null));
    }

    static Optional<Draft> temperature(RuleConfig config, LocalDate day, Days days) {
        return deviationStreak(config, day, days, Features.TEMP_NIGHT, true).map(found -> {
            DayResults results = days.get(day);
            Double delta = results.metrics().get("temp_deviation");
            if (delta == null) {
                delta = difference(results, Features.TEMP_NIGHT);
            }
            String amount = delta == null ? "Sopra la tua media" : signed(delta, 1) + " °C rispetto alla tua media";
            return found.draft(
                    "Temperatura della notte sopra il tuo solito",
                    amount + nightsSuffix(found.streak()) + ". Riposo e liquidi possono aiutare.",
                    "delta", delta == null ? null : round(delta, 2));
        });
    }

    static Optional<Draft> restingHr(RuleConfig config, LocalDate day, Days days) {
        return deviationStreak(config, day, days, Features.RESTING_HR, true).map(found -> {
            Double delta = difference(days.get(day), Features.RESTING_HR);
            String amount = delta == null ? "Sopra la tua media" : signed(delta, 0) + " battiti al minuto rispetto alla tua media";
            return found.draft(
                    "Battito a riposo sopra il tuo solito",
                    amount + nightsSuffix(found.streak()) + ". Una giornata più leggera e un buon sonno possono aiutare.",
                    "delta", delta == null ? null : round(delta, 1));
        });
    }

    static Optional<Draft> hrv(RuleConfig config, LocalDate day, Days days) {
        return deviationStreak(config, day, days, Features.HRV_NIGHT, false).map(found -> {
            Double delta = difference(days.get(day), Features.HRV_NIGHT);
            String amount = delta == null ? "Sotto la tua media" : signed(delta, 0) + " millisecondi rispetto alla tua media";
            return found.draft(
                    "Variabilità del battito (HRV) sotto il tuo solito",
                    amount + nightsSuffix(found.streak()) + ". Una sera tranquilla e un buon sonno possono aiutare.",
                    "delta", delta == null ? null : round(delta, 1));
        });
    }

    /**
     * «Da guardare» of the night breathing ({@link NightBreathing}): the stored `spo2_night` detail has status
     * `watch`, i.e. at least 3 nights in a row at −2 deviations or less. The text keeps the wording of the SpO2 card.
     */
    static Optional<Draft> breathing(LocalDate day, Days days) {
        DayResults results = days.get(day);
        Map<String, Object> detail = results == null ? null : results.details().get("spo2_night");
        String watch = NightBreathing.Status.WATCH.name().toLowerCase(java.util.Locale.ROOT);
        if (detail == null || !watch.equals(detail.get("status"))) {
            return Optional.empty();
        }
        int streak = detail.get("streak") instanceof Number n ? n.intValue() : NightBreathing.WATCH_NIGHTS;
        Double median = results.metrics().get("spo2_night");
        Double yours = results.medians().get(Features.SPO2_MEDIAN);
        StringBuilder body = new StringBuilder("Ossigeno della notte (SpO2)");
        if (median != null) {
            body.append(' ').append(decimal(median, 1)).append('%');
            if (yours != null) {
                body.append(" contro il tuo ").append(decimal(yours, 1)).append('%');
            }
            body.append(", ");
        } else {
            body.append(" sotto il tuo solito, ");
        }
        body.append(nightsInARow(Math.max(2, streak)))
                .append(". Non è una diagnosi: se il calo continua, parlane con un medico.");
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("streak", streak);
        if (median != null) {
            values.put("median", median);
        }
        if (detail.get("deviation") instanceof Number deviation) {
            values.put("deviation", deviation.doubleValue());
        }
        return Optional.of(new Draft("Ossigeno della notte sotto il tuo solito", body.toString(), values, null));
    }

    // --- rules with a threshold ---

    static Optional<Draft> recoveryLow(RuleConfig config, LocalDate day, Days days) {
        double threshold = config.threshold();
        Predicate<DayResults> low = r -> r.scores().get("recovery") != null && r.scores().get("recovery") < threshold;
        int streak = streak(day, days, low);
        if (streak == 0 || streak < config.days()) {
            return Optional.empty();
        }
        int value = days.get(day).scores().get("recovery");
        String title = streak >= 2 ? "Recupero basso da " + streak + " giorni" : "Recupero basso";
        String body = value + " su 100, sotto " + decimal(threshold, 0) + (streak >= 2 ? " " + daysInARow(streak) : "")
                + ". Una giornata più leggera e un buon sonno possono aiutare.";
        return Optional.of(new Draft(title, body, values("value", value, "threshold", threshold, "streak", streak, "days", config.days()), null));
    }

    /** `sleep_debt` over the threshold; delivered not before 21:00 local time of that day. */
    static Optional<Draft> sleepDebt(RuleConfig config, LocalDate day, Days days, ZoneId zone) {
        DayResults results = days.get(day);
        Double debt = results == null ? null : results.metrics().get("sleep_debt");
        if (debt == null || debt <= config.threshold()) {
            return Optional.empty();
        }
        long deliverAfter = day.atTime(LocalTime.of(AlertCatalog.SLEEP_DEBT_HOUR, 0)).atZone(zone).toInstant().toEpochMilli();
        return Optional.of(new Draft(
                "Debito di sonno oltre " + decimal(config.threshold(), 1) + " ore",
                decimal(debt, 1) + " ore negli ultimi 7 giorni. Stasera andare a letto un po' prima può aiutare.",
                values("hours", round(debt, 2), "threshold", config.threshold()),
                deliverAfter));
    }

    /** Steps under the threshold for N finished days in a row: today, still in progress, never counts. */
    static Optional<Draft> stepsLow(RuleConfig config, LocalDate day, Days days, LocalDate today) {
        if (!day.isBefore(today)) {
            return Optional.empty();
        }
        double threshold = config.threshold();
        Predicate<DayResults> low = r -> r.features().get(Features.STEPS) != null && r.features().get(Features.STEPS) < threshold;
        int streak = streak(day, days, low);
        if (streak == 0 || streak < config.days()) {
            return Optional.empty();
        }
        double steps = days.get(day).features().get(Features.STEPS);
        String title = streak >= 2 ? "Pochi passi da " + streak + " giorni" : "Pochi passi";
        String body = thousands(steps) + " passi, sotto " + thousands(threshold) + (streak >= 2 ? " " + daysInARow(streak) : "")
                + ". Una breve passeggiata può aiutare.";
        return Optional.of(new Draft(
                title, body, values("steps", Math.round(steps), "threshold", threshold, "streak", streak, "days", config.days()), null));
    }

    // --- helpers ---

    /** A deviation rule that fired: the deviation of the day and how many nights in a row met the weaker condition. */
    private record Found(RuleConfig config, double deviation, int streak, boolean strong) {

        Draft draft(String title, String body, String amountKey, Object amount) {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("deviation", round(deviation, 2));
            if (amount != null) {
                values.put(amountKey, amount);
            }
            values.put("streak", streak);
            values.put("strong", strong);
            values.put("sensitivity", config.sensitivity());
            values.put("days", config.days());
            return new Draft(title, body, values, null);
        }
    }

    /**
     * The «≥ +S, or ≥ +1 for N nights» condition (`up`), or its mirror «≤ −S, or ≤ −1 for N nights». Empty when the day
     * has no deviation (calibration) or neither condition holds.
     */
    private static Optional<Found> deviationStreak(RuleConfig config, LocalDate day, Days days, String feature, boolean up) {
        DayResults results = days.get(day);
        Double deviation = results == null ? null : results.deviations().get(feature);
        if (deviation == null) {
            return Optional.empty();
        }
        Predicate<DayResults> weak = r -> {
            Double d = r.deviations().get(feature);
            return d != null && (up ? d >= AlertCatalog.STREAK_DEVIATION : d <= -AlertCatalog.STREAK_DEVIATION);
        };
        int streak = streak(day, days, weak);
        double oriented = up ? deviation : -deviation;
        boolean strong = oriented >= config.sensitivityDeviations();
        if (!strong && streak < config.days()) {
            return Optional.empty();
        }
        return Optional.of(new Found(config, deviation, streak, strong));
    }

    /** How many consecutive days, ending on `day`, meet the condition. A day without results breaks the run. */
    static int streak(LocalDate day, Days days, Predicate<DayResults> condition) {
        int streak = 0;
        for (LocalDate d = day; ; d = d.minusDays(1)) {
            DayResults results = days.get(d);
            if (results == null || !condition.test(results)) {
                return streak;
            }
            streak++;
        }
    }

    private static String nightsSuffix(int streak) {
        return streak >= 2 ? ", " + nightsInARow(streak) : "";
    }

    /** Value minus your median, in the feature's unit; null without either. */
    private static Double difference(DayResults results, String feature) {
        Double value = results.features().get(feature);
        Double median = results.medians().get(feature);
        return value == null || median == null ? null : value - median;
    }

    private static void putDeviation(Map<String, Object> values, String key, DayResults results, String feature) {
        Double deviation = results.deviations().get(feature);
        if (deviation != null) {
            values.put(key, round(deviation, 2));
        }
    }

    private static Map<String, Object> values(Object... pairs) {
        Map<String, Object> values = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            if (pairs[i + 1] != null) {
                values.put((String) pairs[i], pairs[i + 1]);
            }
        }
        return values;
    }

    private static double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }
}
