package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.DailyRepository.MetricRow;
import com.ringlife.backend.compute.DailyRepository.ScoreRow;
import com.ringlife.backend.score.Baseline;
import com.ringlife.backend.score.ScoreResult;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** {@link History} sui dati del calcolo giornaliero, nella versione corrente delle formule. */
@Component
class HistoryReader implements History {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private final DailyRepository repository;
    private final ObjectMapper json;

    HistoryReader(DailyRepository repository, ObjectMapper json) {
        this.repository = repository;
        this.json = json;
    }

    @Override
    public List<DayResults> days(String deviceId, LocalDate from, LocalDate to) {
        Map<LocalDate, Map<String, Integer>> scores = new TreeMap<>();
        for (ScoreRow row : repository.scores(deviceId, from, to, ScoreResult.V1)) {
            scores.computeIfAbsent(LocalDate.parse(row.day()), d -> new java.util.LinkedHashMap<>()).put(row.kind(), row.value());
        }
        Map<LocalDate, Map<String, Double>> metrics = new TreeMap<>();
        Map<LocalDate, Map<String, Map<String, Object>>> details = new TreeMap<>();
        for (MetricRow row : repository.metrics(deviceId, from, to, ScoreResult.V1)) {
            if (row.value() != null) {
                metrics.computeIfAbsent(LocalDate.parse(row.day()), d -> new java.util.LinkedHashMap<>()).put(row.metric(), row.value());
            }
            if (row.detail() != null) {
                try {
                    Map<String, Object> detail = json.readValue(row.detail(), MAP);
                    if (detail != null) {
                        details.computeIfAbsent(LocalDate.parse(row.day()), d -> new java.util.LinkedHashMap<>()).put(row.metric(), detail);
                    }
                } catch (RuntimeException e) {
                    // A detail that is not a JSON object (e.g. a list) is left out: the value stays readable.
                }
            }
        }
        Map<LocalDate, Map<String, Double>> features = new TreeMap<>();
        repository.featureValues(deviceId, from, to).forEach((day, values) -> features.put(LocalDate.parse(day), values));

        Map<String, Map<String, DailyRepository.BaselineRow>> baselines = repository.baselineRows(deviceId, from, to);

        TreeMap<LocalDate, DayResults> days = new TreeMap<>();
        for (LocalDate day : union(scores.keySet(), metrics.keySet(), features.keySet(), details.keySet())) {
            Map<String, Double> dayFeatures = features.getOrDefault(day, Map.of());
            Map<String, Double> deviations = new java.util.LinkedHashMap<>();
            Map<String, Double> medians = new java.util.LinkedHashMap<>();
            baselines.getOrDefault(day.toString(), Map.of()).forEach((feature, row) -> {
                medians.put(feature, row.median());
                Double value = dayFeatures.get(feature);
                if (value != null) {
                    deviations.put(feature, new Baseline(row.median(), row.mad(), row.count(), Features.minSpread(feature)).deviation(value));
                }
            });
            days.put(day, new DayResults(
                    day, scores.getOrDefault(day, Map.of()), metrics.getOrDefault(day, Map.of()), dayFeatures, deviations, medians,
                    details.getOrDefault(day, Map.of())));
        }
        return new ArrayList<>(days.values());
    }

    @SafeVarargs
    private static java.util.Set<LocalDate> union(java.util.Set<LocalDate>... sets) {
        java.util.Set<LocalDate> all = new java.util.TreeSet<>();
        for (java.util.Set<LocalDate> set : sets) {
            all.addAll(set);
        }
        return all;
    }
}
