package com.ringlife.backend.score;

import java.util.List;
import java.util.Optional;

import com.ringlife.backend.score.ScoreResult.Component;

/**
 * Sleep Index v1 (docs/scores.md). Durata 30%, efficienza 15%, profondo 15%, REM 15%, risvegli 10%,
 * regolarita' 10%, battito minimo 5%. Pesi e soglie dei sotto-punteggi sono iniziali, da tarare.
 */
public final class SleepIndex {

    private SleepIndex() {}

    public static final String DURATION = "sleep-duration";
    public static final String EFFICIENCY = "sleep-efficiency";
    public static final String DEEP = "sleep-deep";
    public static final String REM = "sleep-rem";
    public static final String AWAKENINGS = "sleep-awakenings";
    public static final String REGULARITY = "sleep-regularity";
    public static final String MIN_HR = "sleep-min-hr";

    /** Efficienza: 75% vale 0, 95% vale 100. */
    static final double EFFICIENCY_FLOOR = 0.75;
    static final double EFFICIENCY_FULL = 0.95;
    /** Quota di sonno profondo e REM che vale il punteggio pieno. */
    static final double DEEP_FULL_SHARE = 0.15;
    static final double REM_FULL_SHARE = 0.20;
    /** Punti persi per ogni risveglio e per ogni minuto sveglio. */
    static final double POINTS_PER_AWAKENING = 10;
    static final double POINTS_PER_AWAKE_MIN = 0.5;

    /**
     * @param goalMin obiettivo di sonno in minuti
     * @param regularity regolarita' 0-100 (vedi {@link SleepRegularity}), null se non calcolabile
     * @param minHrDeviation scostamento del battito minimo notturno dalla baseline, null senza baseline
     */
    public static Optional<ScoreResult> compute(SleepNight night, int goalMin, Integer regularity, Double minHrDeviation) {
        if (night.asleepMin() == 0) {
            return Optional.empty();
        }
        double asleep = night.asleepMin();
        int efficiency = Stats.round(Stats.clamp(
                (night.efficiency() - EFFICIENCY_FLOOR) / (EFFICIENCY_FULL - EFFICIENCY_FLOOR) * 100, 0, 100));
        int awakenings = Stats.round(Stats.clamp(
                100 - POINTS_PER_AWAKENING * night.awakenings() - POINTS_PER_AWAKE_MIN * night.awakeMin(), 0, 100));
        List<Component> components = List.of(
                ScoreResult.component(DURATION, 0.30, ScoreResult.ratioScore(asleep, goalMin)),
                ScoreResult.component(EFFICIENCY, 0.15, efficiency),
                ScoreResult.component(DEEP, 0.15, ScoreResult.ratioScore(night.deepMin() / asleep, DEEP_FULL_SHARE)),
                ScoreResult.component(REM, 0.15, ScoreResult.ratioScore(night.remMin() / asleep, REM_FULL_SHARE)),
                ScoreResult.component(AWAKENINGS, 0.10, awakenings),
                ScoreResult.component(REGULARITY, 0.10, regularity),
                // Un battito minimo piu' basso del solito e' meglio: lo scostamento si inverte.
                ScoreResult.component(
                        MIN_HR, 0.05, minHrDeviation == null ? null : ScoreResult.fromDeviation(-minHrDeviation)));
        return ScoreResult.combine(components);
    }
}
