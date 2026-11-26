package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * I risultati giornalieri di un dispositivo, in sola lettura, per chi li consuma fuori dal calcolo (i plugin,
 * ADR 0013). Un giorno senza niente non compare nell'elenco.
 */
public interface History {

    /**
     * I risultati di un giorno locale: indici 0-100, metriche con unita' e feature estratte. `deviations` e' lo
     * scostamento dalla tua media di ogni feature con una baseline, tra -3 e 3, positivo = sopra la tua media (ADR 0009).
     *
     * <p>`medians` is your median (the baseline) of each feature that has one, in the feature's unit. `details` is the
     * stored `detail` object of each metric that has one (e.g. `spo2_night` with `status` and `streak`, `strain_level`
     * with `level` and `count`), also when the metric has no value. Both are empty when the reader does not load them.
     */
    record DayResults(
            LocalDate day,
            Map<String, Integer> scores,
            Map<String, Double> metrics,
            Map<String, Double> features,
            Map<String, Double> deviations,
            Map<String, Double> medians,
            Map<String, Map<String, Object>> details) {

        public DayResults(
                LocalDate day,
                Map<String, Integer> scores,
                Map<String, Double> metrics,
                Map<String, Double> features,
                Map<String, Double> deviations) {
            this(day, scores, metrics, features, deviations, Map.of(), Map.of());
        }

        public DayResults(LocalDate day, Map<String, Integer> scores, Map<String, Double> metrics, Map<String, Double> features) {
            this(day, scores, metrics, features, Map.of());
        }
    }

    /** I giorni dell'intervallo (estremi inclusi) che hanno almeno un risultato, in ordine di data. */
    List<DayResults> days(String deviceId, LocalDate from, LocalDate to);
}
