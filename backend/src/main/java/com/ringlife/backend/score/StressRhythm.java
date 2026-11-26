package com.ringlife.backend.score;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import com.ringlife.backend.score.ScoreResult.Component;

/**
 * Stress Rhythm v1 (docs/scores.md): quota di tempo diurno con stress alto (70%) e recupero nelle ore serali (30%).
 * L'indice e' 0-100 e piu' alto vuol dire una giornata piu' tranquilla. Si calcola a giornata finita.
 * Le misure sono i campioni STRESS dell'anello (piu' alto = piu' stress): soglia e scala sono ipotesi da
 * verificare sull'anello vero.
 */
public final class StressRhythm {

    private StressRhythm() {}

    public static final String LOAD = "stress-load";
    public static final String EVENING = "stress-evening";

    /** Il giorno conta dalle 07:00 alle 23:00; la sera comincia alle 19:00. Minuti dalla mezzanotte locale. */
    public static final int DAY_FROM = 7 * 60;
    public static final int EVENING_FROM = 19 * 60;
    public static final int DAY_TO = 23 * 60;
    /** Un campione e' «stress alto» da questo valore in su. Iniziale, da tarare. */
    public static final double HIGH = 60;
    /** Campioni minimi nelle ore diurne per fidarsi dell'indice, e in ognuna delle due fasce per il recupero serale. */
    public static final int MIN_DAY_SAMPLES = 8;
    public static final int MIN_WINDOW_SAMPLES = 3;
    /** Con meta' dei campioni diurni alti il punteggio del carico e' zero. */
    static final double FULL_LOAD_SHARE = 0.5;
    /** Un calo di 20 punti di stress dal giorno alla sera vale il punteggio pieno, un aumento di 20 lo azzera. */
    static final double EVENING_POINTS = 2.5;

    /** Un campione STRESS: minuti dalla mezzanotte locale e valore. */
    public record Reading(int minuteOfDay, double value) {}

    /**
     * I numeri da cui nasce l'indice, per mostrarli: campioni diurni, quota con stress alto (0-1) e mediane del giorno
     * e della sera (null con meno di 3 campioni in quella fascia).
     */
    public record Summary(int samples, double highShare, Double dayMedian, Double eveningMedian) {}

    private record Windows(List<Double> day, List<Double> evening, int high) {}

    private static Windows windows(List<Reading> readings) {
        List<Double> day = new ArrayList<>();
        List<Double> evening = new ArrayList<>();
        int high = 0;
        for (Reading reading : readings) {
            if (reading.minuteOfDay() < DAY_FROM || reading.minuteOfDay() >= DAY_TO) {
                continue;
            }
            (reading.minuteOfDay() < EVENING_FROM ? day : evening).add(reading.value());
            if (reading.value() >= HIGH) {
                high++;
            }
        }
        return new Windows(day, evening, high);
    }

    /** Vuoto con meno di 8 campioni diurni: la stessa regola dell'indice. */
    public static Optional<Summary> summary(List<Reading> readings) {
        Windows w = windows(readings);
        int daytime = w.day().size() + w.evening().size();
        if (daytime < MIN_DAY_SAMPLES) {
            return Optional.empty();
        }
        return Optional.of(new Summary(
                daytime,
                (double) w.high() / daytime,
                w.day().size() >= MIN_WINDOW_SAMPLES ? Stats.median(w.day()) : null,
                w.evening().size() >= MIN_WINDOW_SAMPLES ? Stats.median(w.evening()) : null));
    }

    public static Optional<ScoreResult> compute(List<Reading> readings) {
        Windows w = windows(readings);
        List<Double> day = w.day();
        List<Double> evening = w.evening();
        int daytime = day.size() + evening.size();
        if (daytime < MIN_DAY_SAMPLES) {
            return Optional.empty();
        }
        double share = (double) w.high() / daytime;
        int load = Stats.round(100 * (1 - Math.min(share / FULL_LOAD_SHARE, 1)));
        Integer recovery = null;
        if (day.size() >= MIN_WINDOW_SAMPLES && evening.size() >= MIN_WINDOW_SAMPLES) {
            double drop = Stats.median(day) - Stats.median(evening);
            recovery = Stats.round(Stats.clamp(50 + EVENING_POINTS * drop, 0, 100));
        }
        return ScoreResult.combine(List.of(
                new Component(LOAD, 0.7, load),
                new Component(EVENING, 0.3, recovery)));
    }
}
