package com.ringlife.backend.score;

import java.util.List;
import java.util.Optional;

/**
 * Media personale di una metrica: mediana e MAD sugli ultimi 28 giorni (docs/scores.md).
 * Servono almeno 7 giorni, altrimenti non c'e' baseline («calibrazione in corso»).
 */
public record Baseline(double median, double mad, int count, double minSpread) {

    public static final int WINDOW_DAYS = 28;
    public static final int MIN_DAYS = 7;
    public static final double MAD_SCALE = 1.4826;
    public static final double MAX_DEVIATION = 3;

    /**
     * @param daily valori giornalieri, dal piu' vecchio al piu' recente. Si usano gli ultimi 28.
     * @param minSpread variabilita' minima della metrica, nella sua unita': le misure intere o molto
     *     stabili hanno MAD 0 e senza un minimo ogni scarto sembrerebbe enorme.
     */
    public static Optional<Baseline> of(List<Double> daily, double minSpread) {
        List<Double> window = daily.subList(Math.max(0, daily.size() - WINDOW_DAYS), daily.size());
        if (window.size() < MIN_DAYS) {
            return Optional.empty();
        }
        return Optional.of(new Baseline(Stats.median(window), Stats.mad(window), window.size(), minSpread));
    }

    /** Il denominatore di `deviation`: `1,4826 * MAD`, mai sotto la variabilita' minima della metrica. */
    public double spread() {
        return Math.max(MAD_SCALE * mad, minSpread);
    }

    /** `dev = (x - mediana) / (1,4826 * MAD)`, limitato a [-3, 3]. Positivo = sopra la tua media. */
    public double deviation(double value) {
        return Stats.clamp((value - median) / spread(), -MAX_DEVIATION, MAX_DEVIATION);
    }
}
