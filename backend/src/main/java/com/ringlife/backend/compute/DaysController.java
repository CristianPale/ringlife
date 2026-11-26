package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.compute.DailyRepository.MetricRow;
import com.ringlife.backend.compute.DailyRepository.ScoreRow;
import com.ringlife.backend.score.Baseline;
import com.ringlife.backend.score.ScoreResult;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Lettura dei risultati del calcolo giornaliero. L'autenticazione e' nell'interceptor del dispositivo. */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/days")
class DaysController {

    static final int MAX_RANGE_DAYS = 120;

    record ScoreView(int value, String algoVersion, JsonNode components) {}

    record MetricView(Double value, String unit, JsonNode detail, String algoVersion) {}

    record StageView(String stage, long start, long end) {}

    /** La notte che finisce in questo giorno: la sessione più lunga, con le sue fasi. Orari in ms dall'epoca (UTC). */
    record SleepView(long start, long end, List<StageView> stages) {}

    /**
     * La tua media di una feature e di quanto il valore del giorno se ne scosta (null se quel giorno non ha il valore).
     * `spread` e' l'unita' dello scostamento nella unita' della metrica: il tuo solito va da `median - 1,5 * spread`
     * a `median + 1,5 * spread`.
     */
    record ReferenceView(double median, Double deviation, double spread) {}

    /**
     * `baselines` dice per ogni feature su quanti giorni si basa la tua media: assente = calibrazione in corso.
     * `features` sono i valori del giorno (es. `hrv_night`, `resting_hr`); `references` la tua media e lo scostamento
     * `(x - mediana) / (1,4826 * MAD)` limitato a [-3, 3], positivo = sopra la tua media.
     * `stressByHour` e' lo stress medio per ora locale, 24 valori (null per le ore senza campioni; assente senza campioni).
     * `sleep` e' la notte con le fasi (null senza sonno); `stepsByHour` i passi per ora locale, 24 valori (null senza passi).
     * `scoreReferences` da' la stessa coppia (mediana, scostamento) per ogni indice del giorno, rispetto ai 28 giorni
     * precedenti; senza almeno 7 giorni di storia l'indice non ha riferimento (ADR 0020).
     */
    record DayView(
            String day,
            Map<String, ScoreView> scores,
            Map<String, MetricView> metrics,
            Map<String, Integer> baselines,
            Map<String, Double> features,
            Map<String, ReferenceView> references,
            Map<String, ReferenceView> scoreReferences,
            SleepView sleep,
            int[] stepsByHour,
            Double[] stressByHour) {}

    private final DailyRepository repository;
    private final ObjectMapper json;
    private final ComputeSettings settings;

    DaysController(DailyRepository repository, ObjectMapper json, ComputeSettings settings) {
        this.repository = repository;
        this.json = json;
        this.settings = settings;
    }

    @GetMapping("/{day}")
    DayView one(@PathVariable String deviceId, @PathVariable String day) {
        LocalDate date = parse(day);
        return range(deviceId, date, date).get(0);
    }

    @GetMapping
    List<DayView> many(@PathVariable String deviceId, @RequestParam String from, @RequestParam String to) {
        LocalDate start = parse(from);
        LocalDate end = parse(to);
        if (end.isBefore(start)) {
            throw ApiException.badRequest("Intervallo non valido");
        }
        if (start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("Intervallo troppo lungo: massimo " + MAX_RANGE_DAYS + " giorni");
        }
        return range(deviceId, start, end);
    }

    private List<DayView> range(String deviceId, LocalDate from, LocalDate to) {
        String version = ScoreResult.V1;
        Map<String, Map<String, ScoreView>> scores = new LinkedHashMap<>();
        // Valori dei 28 giorni prima dell'intervallo compresi: servono alla media personale di ogni indice.
        Map<String, TreeMap<LocalDate, Integer>> series = new LinkedHashMap<>();
        for (ScoreRow row : repository.scores(deviceId, from.minusDays(Baseline.WINDOW_DAYS), to, version)) {
            LocalDate rowDay = LocalDate.parse(row.day());
            series.computeIfAbsent(row.kind(), k -> new TreeMap<>()).put(rowDay, row.value());
            if (!rowDay.isBefore(from)) {
                scores.computeIfAbsent(row.day(), d -> new LinkedHashMap<>())
                        .put(row.kind(), new ScoreView(row.value(), row.algoVersion(), json.readTree(row.components())));
            }
        }
        Map<String, Map<String, MetricView>> metrics = new LinkedHashMap<>();
        for (MetricRow row : repository.metrics(deviceId, from, to, version)) {
            JsonNode detail = row.detail() == null ? null : json.readTree(row.detail());
            metrics.computeIfAbsent(row.day(), d -> new LinkedHashMap<>())
                    .put(row.metric(), new MetricView(row.value(), row.unit(), detail, row.algoVersion()));
        }
        Map<String, Map<String, DailyRepository.BaselineRow>> baselineRows = repository.baselineRows(deviceId, from, to);
        Map<String, Map<String, Double>> features = repository.featureValues(deviceId, from, to);
        List<DayView> days = new java.util.ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            String key = day.toString();
            Map<String, Double> dayFeatures = features.getOrDefault(key, Map.of());
            Map<String, Integer> counts = new LinkedHashMap<>();
            Map<String, ReferenceView> references = new LinkedHashMap<>();
            baselineRows.getOrDefault(key, Map.of()).forEach((feature, row) -> {
                counts.put(feature, row.count());
                Double value = dayFeatures.get(feature);
                Baseline baseline = new Baseline(row.median(), row.mad(), row.count(), Features.minSpread(feature));
                Double deviation = value == null ? null : Math.round(baseline.deviation(value) * 100) / 100.0;
                references.put(feature, new ReferenceView(row.median(), deviation, round2(baseline.spread())));
            });
            days.add(new DayView(
                    key, scores.getOrDefault(key, Map.of()), metrics.getOrDefault(key, Map.of()), counts, dayFeatures,
                    references, scoreReferences(day, scores.getOrDefault(key, Map.of()), series),
                    sleep(deviceId, day), stepsByHour(deviceId, day), stressByHour(deviceId, day)));
        }
        return days;
    }

    /** Mediana e scostamento di ogni indice del giorno rispetto ai 28 giorni precedenti (il giorno stesso escluso). */
    private static Map<String, ReferenceView> scoreReferences(
            LocalDate day, Map<String, ScoreView> todays, Map<String, TreeMap<LocalDate, Integer>> series) {
        Map<String, ReferenceView> references = new LinkedHashMap<>();
        todays.forEach((kind, score) -> {
            List<Double> history = series.get(kind)
                    .subMap(day.minusDays(Baseline.WINDOW_DAYS), true, day.minusDays(1), true)
                    .values().stream().map(Integer::doubleValue).toList();
            Baseline.of(history, Features.SCORE_MIN_SPREAD).ifPresent(baseline -> references.put(
                    kind,
                    new ReferenceView(
                            baseline.median(),
                            Math.round(baseline.deviation(score.value()) * 100) / 100.0,
                            round2(baseline.spread()))));
        });
        return references;
    }

    private SleepView sleep(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        DailyRepository.SessionRow row = repository.longestSessionEnding(deviceId, from, to);
        if (row == null) {
            return null;
        }
        List<StageView> stages = repository.stages(row.id()).stream()
                .map(s -> new StageView(s.stage(), s.startMs(), s.endMs()))
                .toList();
        return new SleepView(row.startMs(), row.endMs(), stages);
    }

    private int[] stepsByHour(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        List<FeatureExtractor.Sample> steps = repository.samples(deviceId, "STEPS", from, to);
        return steps.isEmpty() ? null : FeatureExtractor.stepsByHour(steps, settings.zone());
    }

    private Double[] stressByHour(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        List<FeatureExtractor.Sample> samples = repository.samples(deviceId, "STRESS", from, to);
        if (samples.isEmpty()) {
            return null;
        }
        double[] sum = new double[24];
        int[] count = new int[24];
        for (FeatureExtractor.Sample sample : samples) {
            int hour = java.time.Instant.ofEpochMilli(sample.ts()).atZone(settings.zone()).getHour();
            sum[hour] += sample.value();
            count[hour]++;
        }
        Double[] byHour = new Double[24];
        for (int hour = 0; hour < 24; hour++) {
            byHour[hour] = count[hour] == 0 ? null : Math.round(sum[hour] / count[hour] * 10) / 10.0;
        }
        return byHour;
    }

    private static double round2(double value) {
        return Math.round(value * 100) / 100.0;
    }

    private static LocalDate parse(String value) {
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("Data non valida: usa AAAA-MM-GG");
        }
    }
}
