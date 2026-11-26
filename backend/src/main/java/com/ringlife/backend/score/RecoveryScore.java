package com.ringlife.backend.score;

import java.util.List;
import java.util.Optional;

import com.ringlife.backend.score.ScoreResult.Component;

/**
 * Recovery Score v1 (docs/scores.md): HRV 35%, battito a riposo 25%, temperatura 15%, Sleep Index 15%,
 * stress del giorno prima 10%. Gli scostamenti sono quelli grezzi dalla tua media (positivo = sopra):
 * qui si orientano, perche' un HRV piu' alto e' meglio mentre un battito o una temperatura piu' alti no.
 */
public final class RecoveryScore {

    private RecoveryScore() {}

    public static final String HRV = "hrv";
    public static final String RESTING_HR = "hr-riposo";
    public static final String TEMPERATURE = "temperatura";
    public static final String SLEEP = "sonno";
    public static final String STRESS = "stress";

    /**
     * @param hrvDeviation scostamento dell'HRV notturna, null senza baseline
     * @param restingHrDeviation scostamento del battito a riposo notturno
     * @param temperatureDeviation scostamento della temperatura notturna
     * @param sleepIndex indice Sonno della notte, 0-100
     * @param previousDayStress indice Stress di ieri, 0-100 (piu' alto = giornata piu' tranquilla)
     */
    public static Optional<ScoreResult> compute(
            Double hrvDeviation,
            Double restingHrDeviation,
            Double temperatureDeviation,
            Integer sleepIndex,
            Integer previousDayStress) {
        List<Component> components = List.of(
                ScoreResult.component(HRV, 0.35, hrvDeviation == null ? null : ScoreResult.fromDeviation(hrvDeviation)),
                ScoreResult.component(
                        RESTING_HR, 0.25,
                        restingHrDeviation == null ? null : ScoreResult.fromDeviation(-restingHrDeviation)),
                ScoreResult.component(
                        TEMPERATURE, 0.15,
                        temperatureDeviation == null ? null : ScoreResult.fromDeviation(-temperatureDeviation)),
                ScoreResult.component(SLEEP, 0.15, sleepIndex),
                ScoreResult.component(STRESS, 0.10, previousDayStress));
        return ScoreResult.combine(components);
    }
}
