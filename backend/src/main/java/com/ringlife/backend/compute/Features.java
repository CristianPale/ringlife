package com.ringlife.backend.compute;

import java.util.List;

/** Nomi delle feature giornaliere (tabella `daily_feature`). */
public final class Features {

    private Features() {}

    public static final String ASLEEP_MIN = "sleep_asleep_min";
    public static final String IN_BED_MIN = "sleep_in_bed_min";
    public static final String DEEP_MIN = "sleep_deep_min";
    public static final String LIGHT_MIN = "sleep_light_min";
    public static final String REM_MIN = "sleep_rem_min";
    public static final String AWAKE_MIN = "sleep_awake_min";
    public static final String AWAKENINGS = "sleep_awakenings";
    /** Punto medio del sonno, in minuti dopo la mezzanotte locale del giorno del risveglio. */
    public static final String MIDPOINT_MIN = "sleep_midpoint_min";
    /**
     * Inizio e fine del sonno, in minuti dopo la mezzanotte locale del giorno del risveglio. L'inizio e' negativo se
     * ci si addormenta prima di mezzanotte (23:40 = -20). Servono alla fascia «il tuo solito» del giro (ADR 0020).
     */
    public static final String SLEEP_START_MIN = "sleep_start_min";
    public static final String SLEEP_END_MIN = "sleep_end_min";
    public static final String RESTING_HR = "resting_hr";
    public static final String MIN_HR = "min_hr";
    public static final String HRV_NIGHT = "hrv_night";
    public static final String TEMP_NIGHT = "temp_night";
    public static final String SPO2_MEDIAN = "spo2_median";
    public static final String SPO2_MIN = "spo2_min";
    public static final String SPO2_COUNT = "spo2_count";
    public static final String STEPS = "steps";
    /** Stress del giorno (solo giorni finiti): campioni diurni, quota con stress alto 0-1, mediane del giorno e della sera. */
    public static final String STRESS_SAMPLES = "stress_samples";
    public static final String STRESS_HIGH_SHARE = "stress_high_share";
    public static final String STRESS_DAY_MEDIAN = "stress_day_median";
    public static final String STRESS_EVENING_MEDIAN = "stress_evening_median";
    public static final String ACTIVE_HOURS = "active_hours";
    public static final String HR_MINUTES = "hr_minutes";

    /** Variabilita' minima per metrica, nella sua unita' (vedi {@link com.ringlife.backend.score.Baseline}). */
    public static double minSpread(String feature) {
        return switch (feature) {
            case RESTING_HR, MIN_HR -> 1.0;
            case HRV_NIGHT -> 2.0;
            case TEMP_NIGHT -> 0.15;
            case SPO2_MEDIAN -> 0.5;
            case SLEEP_START_MIN, SLEEP_END_MIN -> 15.0;
            case DEEP_MIN, LIGHT_MIN, REM_MIN, AWAKE_MIN -> 5.0;
            default -> 1.0;
        };
    }

    /** Variabilita' minima per la media personale di un indice 0-100, in punti (ADR 0020). Valore iniziale da tarare. */
    public static final double SCORE_MIN_SPREAD = 3.0;

    /** Feature su cui si calcola una baseline. */
    public static final List<String> WITH_BASELINE = List.of(
            RESTING_HR, MIN_HR, HRV_NIGHT, TEMP_NIGHT, SPO2_MEDIAN,
            SLEEP_START_MIN, SLEEP_END_MIN, DEEP_MIN, LIGHT_MIN, REM_MIN, AWAKE_MIN);
}
