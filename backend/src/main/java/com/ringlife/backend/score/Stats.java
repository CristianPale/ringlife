package com.ringlife.backend.score;

import java.util.Arrays;
import java.util.List;

/** Statistica di base per le formule. Funzioni pure, nessuno stato. */
final class Stats {

    private Stats() {}

    static double median(List<Double> values) {
        if (values.isEmpty()) {
            return Double.NaN;
        }
        double[] sorted = values.stream().mapToDouble(Double::doubleValue).sorted().toArray();
        int mid = sorted.length / 2;
        return sorted.length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /** Mediana degli scarti assoluti dalla mediana (MAD grezza, non scalata). */
    static double mad(List<Double> values) {
        double mid = median(values);
        return median(values.stream().map(v -> Math.abs(v - mid)).toList());
    }

    static double mean(List<Double> values) {
        return values.isEmpty() ? Double.NaN : values.stream().mapToDouble(Double::doubleValue).sum() / values.size();
    }

    /** Deviazione standard della popolazione. */
    static double standardDeviation(List<Double> values) {
        double mean = mean(values);
        return Math.sqrt(mean(values.stream().map(v -> (v - mean) * (v - mean)).toList()));
    }

    static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    static int round(double value) {
        return (int) Math.round(value);
    }

    static List<Double> boxed(double... values) {
        return Arrays.stream(values).boxed().toList();
    }
}
