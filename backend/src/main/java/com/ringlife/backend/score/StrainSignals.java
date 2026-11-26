package com.ringlife.backend.score;

import java.util.List;

/**
 * Segnali di affaticamento v1 (docs/nuove-funzioni.md, sezione 1): battito a riposo su, HRV giu', temperatura su,
 * tutti rispetto alla propria media. Due segnali «attenzione», tre «alto». Nessun livello senza baseline per tutti e
 * tre. Una causa comune dal diario (alcol, pasto tardo) viene citata e limita il livello a «attenzione».
 */
public final class StrainSignals {

    private StrainSignals() {}

    public static final double THRESHOLD = 1;

    public enum Level { NONE, ATTENTION, HIGH }

    public enum Cause { ALCOHOL, LATE_MEAL }

    /** `level` null = calibrazione in corso. */
    public record Result(Level level, int count, Cause cause) {}

    /** Gli scostamenti sono grezzi (positivo = sopra la media); null = baseline non valida. */
    public static Result evaluate(Double rhr, Double hrv, Double temp, List<Cause> causes) {
        if (rhr == null || hrv == null || temp == null) {
            return new Result(null, 0, null);
        }
        int count = (rhr >= THRESHOLD ? 1 : 0) + (hrv <= -THRESHOLD ? 1 : 0) + (temp >= THRESHOLD ? 1 : 0);
        Cause cause = causes.isEmpty() ? null : causes.get(0);
        if (count >= 3) {
            return new Result(cause != null ? Level.ATTENTION : Level.HIGH, count, cause);
        }
        if (count == 2) {
            return new Result(Level.ATTENTION, count, cause);
        }
        return new Result(Level.NONE, count, null);
    }
}
