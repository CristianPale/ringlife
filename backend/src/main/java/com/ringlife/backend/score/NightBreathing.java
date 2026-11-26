package com.ringlife.backend.score;

import java.util.ArrayList;
import java.util.List;

/**
 * Respiro notturno v1 (docs/nuove-funzioni.md, sezione 6): mediana SpO2 della notte contro la media personale delle
 * 28 notti precedenti. «Da guardare» solo con 3 notti consecutive sotto -2 scostamenti. Nessuna soglia assoluta.
 */
public final class NightBreathing {

    private NightBreathing() {}

    public static final int MIN_SAMPLES = 10;
    public static final double WATCH_DEVIATION = -2;
    public static final int WATCH_NIGHTS = 3;
    /** Le misure sono intere: la variabilita' non scende sotto mezzo punto percentuale. */
    public static final double MIN_SPREAD = 0.5;

    public enum Status { INSUFFICIENT, CALIBRATING, OK, WATCH }

    public record Result(Status status, Double median, Integer min, int count, Double deviation, int streak) {}

    /**
     * @param tonight misure SpO2 tra inizio e fine del sonno
     * @param previousMedians mediane delle notti precedenti, dalla piu' vecchia, senza stanotte
     */
    public static Result evaluate(List<Double> tonight, List<Double> previousMedians) {
        if (tonight.size() < MIN_SAMPLES) {
            return new Result(Status.INSUFFICIENT, null, null, tonight.size(), null, 0);
        }
        double median = Stats.median(tonight);
        int min = (int) Math.round(tonight.stream().mapToDouble(Double::doubleValue).min().orElse(0));
        List<Double> all = new ArrayList<>(previousMedians);
        all.add(median);
        Double[] deviations = new Double[all.size()];
        // Lo scostamento di ogni notte usa solo le notti che la precedono.
        for (int i = 0; i < all.size(); i++) {
            final double value = all.get(i);
            deviations[i] = Baseline.of(all.subList(0, i), MIN_SPREAD).map(b -> b.deviation(value)).orElse(null);
        }
        Double tonightDeviation = deviations[deviations.length - 1];
        if (tonightDeviation == null) {
            return new Result(Status.CALIBRATING, median, min, tonight.size(), null, 0);
        }
        int streak = 0;
        for (int i = deviations.length - 1; i >= 0; i--) {
            if (deviations[i] == null || deviations[i] > WATCH_DEVIATION) {
                break;
            }
            streak++;
        }
        return new Result(
                streak >= WATCH_NIGHTS ? Status.WATCH : Status.OK, median, min, tonight.size(), tonightDeviation, streak);
    }
}
