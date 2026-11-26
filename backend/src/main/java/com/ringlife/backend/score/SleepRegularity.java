package com.ringlife.backend.score;

import java.util.List;
import java.util.Optional;

/**
 * Regolarita' del sonno v1 (docs/nuove-funzioni.md, sezione 3): 0,7 per la costanza del punto medio e 0,3 per lo
 * scarto tra giorni feriali e fine settimana. Servono almeno 5 notti. Con meno di 2 notti nel fine settimana conta
 * solo la costanza.
 */
public final class SleepRegularity {

    private SleepRegularity() {}

    static final int MIN_NIGHTS = 5;
    static final double SD_LIMIT_MIN = 90;
    static final double GAP_LIMIT_MIN = 120;
    static final double SD_WEIGHT = 0.7;

    /** Punto medio in minuti dopo la mezzanotte del giorno del risveglio (le 23:30 valgono -30). */
    public record Night(double midpointMin, boolean weekend) {}

    public record Result(int score, int variationMin, Integer weekendGapMin) {}

    public static Optional<Result> compute(List<Night> nights) {
        if (nights.size() < MIN_NIGHTS) {
            return Optional.empty();
        }
        double variation = Stats.standardDeviation(nights.stream().map(Night::midpointMin).toList());
        double sdComponent = 100 * (1 - Math.min(variation / SD_LIMIT_MIN, 1));
        List<Double> weekdays = nights.stream().filter(n -> !n.weekend()).map(Night::midpointMin).toList();
        List<Double> weekends = nights.stream().filter(Night::weekend).map(Night::midpointMin).toList();
        if (weekends.size() < 2 || weekdays.isEmpty()) {
            return Optional.of(new Result(Stats.round(sdComponent), Stats.round(variation), null));
        }
        double gap = Math.abs(Stats.mean(weekdays) - Stats.mean(weekends));
        double gapComponent = 100 * (1 - Math.min(gap / GAP_LIMIT_MIN, 1));
        return Optional.of(new Result(
                Stats.round(SD_WEIGHT * sdComponent + (1 - SD_WEIGHT) * gapComponent),
                Stats.round(variation),
                Stats.round(gap)));
    }
}
