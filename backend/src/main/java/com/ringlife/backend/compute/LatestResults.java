package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.DailyRepository.MetricRow;
import com.ringlife.backend.compute.DailyRepository.ScoreRow;
import com.ringlife.backend.score.ScoreResult;

/**
 * Gli ultimi risultati di un dispositivo, per chi li mostra fuori dall'app (le entita' di Home Assistant, ADR 0011).
 * Per ogni valore conta l'ultimo giorno che lo ha, nella finestra degli ultimi giorni: un indice che oggi non c'e'
 * ancora mostra quello di ieri, come fa l'app.
 */
@Component
public class LatestResults {

    /** Giorni guardati all'indietro, oggi compreso. */
    static final int WINDOW_DAYS = 7;

    /** Un indice 0-100 con il giorno a cui appartiene e i suoi componenti (JSON). */
    public record Score(String day, int value, String algoVersion, String componentsJson) {}

    /** Ultimo valore di una metrica giornaliera e il suo giorno. */
    public record Metric(String day, double value) {}

    /** `sleepStart` e `sleepEnd` sono istanti in millisecondi UTC dell'ultima notte nella finestra, null se non ce n'e'. */
    public record Latest(
            String deviceId,
            LocalDate today,
            Map<String, Score> scores,
            Map<String, Metric> metrics,
            Map<String, Double> features,
            Double stepsToday,
            Long sleepStart,
            Long sleepEnd,
            Long lastSyncAt) {}

    private final DailyRepository repository;
    private final DailyComputationService computation;
    private final ComputeSettings settings;

    LatestResults(DailyRepository repository, DailyComputationService computation, ComputeSettings settings) {
        this.repository = repository;
        this.computation = computation;
        this.settings = settings;
    }

    /** Il dispositivo che ha caricato dati piu' di recente, null se nessuno. */
    public String latestSyncedDevice() {
        return repository.latestSyncedDevice();
    }

    public Latest of(String deviceId) {
        LocalDate today = computation.today();
        LocalDate from = today.minusDays(WINDOW_DAYS - 1L);

        Map<String, Score> scores = new LinkedHashMap<>();
        // Righe in ordine di giorno: l'ultima di ogni tipo vince.
        for (ScoreRow row : repository.scores(deviceId, from, today, ScoreResult.V1)) {
            scores.put(row.kind(), new Score(row.day(), row.value(), row.algoVersion(), row.components()));
        }
        Map<String, Metric> metrics = new LinkedHashMap<>();
        for (MetricRow row : repository.metrics(deviceId, from, today, ScoreResult.V1)) {
            if (row.value() != null) {
                metrics.put(row.metric(), new Metric(row.day(), row.value()));
            }
        }
        Map<String, Double> features = new LinkedHashMap<>();
        Double stepsToday = null;
        for (Map.Entry<String, Map<String, Double>> day : repository.featureValues(deviceId, from, today).entrySet()) {
            features.putAll(day.getValue());
            if (day.getKey().equals(today.toString())) {
                stepsToday = day.getValue().get(Features.STEPS);
            }
        }

        Long sleepStart = null;
        Long sleepEnd = null;
        for (LocalDate day = today; !day.isBefore(from) && sleepStart == null; day = day.minusDays(1)) {
            long dayFrom = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
            long dayTo = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
            DailyRepository.SessionRow session = repository.longestSessionEnding(deviceId, dayFrom, dayTo);
            if (session != null) {
                sleepStart = session.startMs();
                sleepEnd = session.endMs();
            }
        }
        return new Latest(
                deviceId, today, scores, metrics, features, stepsToday, sleepStart, sleepEnd, repository.lastSyncAt(deviceId));
    }
}
