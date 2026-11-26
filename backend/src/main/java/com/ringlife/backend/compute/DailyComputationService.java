package com.ringlife.backend.compute;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.ringlife.backend.compute.DailyRepository.BaselineRow;
import com.ringlife.backend.compute.DailyRepository.MetricRow;
import com.ringlife.backend.compute.DailyRepository.ScoreRow;
import com.ringlife.backend.compute.DailyRepository.SessionRow;
import com.ringlife.backend.compute.FeatureExtractor.DayData;
import com.ringlife.backend.compute.FeatureExtractor.Sample;
import com.ringlife.backend.compute.FeatureExtractor.Session;
import com.ringlife.backend.score.Baseline;
import com.ringlife.backend.score.MovementIndex;
import com.ringlife.backend.score.NightBreathing;
import com.ringlife.backend.score.RecoveryScore;
import com.ringlife.backend.score.ScoreResult;
import com.ringlife.backend.score.SleepDebt;
import com.ringlife.backend.score.SleepIndex;
import com.ringlife.backend.score.SleepNight;
import com.ringlife.backend.score.SleepRegularity;
import com.ringlife.backend.score.StressRhythm;
import com.ringlife.backend.score.StrainSignals;

import tools.jackson.databind.ObjectMapper;

/**
 * Calcolo giornaliero (ADR 0009): dai dati grezzi alle feature, alle baseline, agli indici. Ripetere il calcolo di un
 * giorno dà lo stesso risultato. Nei log non finisce mai un valore sanitario.
 */
@Service
public class DailyComputationService {

    private static final Logger LOG = LoggerFactory.getLogger(DailyComputationService.class);

    /** Quanti giorni al massimo si ricalcolano dopo un caricamento. */
    static final int MAX_RECOMPUTE_DAYS = 60;
    static final int REGULARITY_NIGHTS = 7;

    private final DailyRepository repository;
    private final ComputeSettings settings;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private final ObjectMapper json;

    DailyComputationService(
            DailyRepository repository,
            ComputeSettings settings,
            Clock clock,
            TransactionTemplate transaction,
            ObjectMapper json) {
        this.repository = repository;
        this.settings = settings;
        this.clock = clock;
        this.transaction = transaction;
        this.json = json;
    }

    public LocalDate today() {
        return clock.instant().atZone(settings.zone()).toLocalDate();
    }

    public LocalDate dayOf(long epochMillis) {
        return java.time.Instant.ofEpochMilli(epochMillis).atZone(settings.zone()).toLocalDate();
    }

    /** Ricalcola dal giorno indicato fino a oggi (al massimo 60 giorni), giorno per giorno in ordine. */
    public void recomputeFrom(String deviceId, LocalDate from) {
        LocalDate today = today();
        LocalDate start = from.isAfter(today) ? today : from;
        LocalDate earliest = today.minusDays(MAX_RECOMPUTE_DAYS - 1L);
        if (start.isBefore(earliest)) {
            start = earliest;
        }
        for (LocalDate day = start; !day.isAfter(today); day = day.plusDays(1)) {
            LocalDate current = day;
            transaction.executeWithoutResult(status -> recomputeDay(deviceId, current));
        }
    }

    /** Job notturno: gli ultimi giorni di ogni dispositivo. */
    public void recomputeRecent(int days) {
        for (String deviceId : repository.deviceIds()) {
            try {
                recomputeFrom(deviceId, today().minusDays(days - 1L));
            } catch (RuntimeException e) {
                LOG.warn("Ricalcolo notturno fallito per un dispositivo: {}", e.getClass().getSimpleName());
            }
        }
    }

    void recomputeDay(String deviceId, LocalDate day) {
        DayData data = load(deviceId, day);
        Map<String, Double> features = FeatureExtractor.extract(data, settings);
        // Lo stress si legge a giornata finita; i suoi numeri restano tra le feature per mostrarli nel dettaglio.
        List<StressRhythm.Reading> stressReadings = day.isBefore(today()) ? stressReadings(deviceId, day) : List.of();
        StressRhythm.summary(stressReadings).ifPresent(summary -> {
            features.put(Features.STRESS_SAMPLES, (double) summary.samples());
            features.put(Features.STRESS_HIGH_SHARE, summary.highShare());
            if (summary.dayMedian() != null) {
                features.put(Features.STRESS_DAY_MEDIAN, summary.dayMedian());
            }
            if (summary.eveningMedian() != null) {
                features.put(Features.STRESS_EVENING_MEDIAN, summary.eveningMedian());
            }
        });
        repository.replaceFeatures(deviceId, day, features);

        // Baseline di ogni feature: i 28 giorni precedenti, il giorno stesso escluso.
        Map<String, BaselineRow> baselines = new LinkedHashMap<>();
        Map<String, Double> deviations = new LinkedHashMap<>();
        for (String feature : Features.WITH_BASELINE) {
            List<Double> history = new ArrayList<>(
                    repository.featureSeries(deviceId, feature, day.minusDays(Baseline.WINDOW_DAYS), day.minusDays(1)).values());
            Optional<Baseline> baseline = Baseline.of(history, Features.minSpread(feature));
            baseline.ifPresent(b -> {
                baselines.put(feature, new BaselineRow(b.median(), b.mad(), b.count()));
                if (features.containsKey(feature)) {
                    deviations.put(feature, b.deviation(features.get(feature)));
                }
            });
        }
        repository.replaceBaselines(deviceId, day, baselines);

        Map<String, ScoreRow> scores = new LinkedHashMap<>();
        Map<String, MetricRow> metrics = new LinkedHashMap<>();
        String version = ScoreResult.V1;

        Optional<SleepRegularity.Result> regularity = regularity(deviceId, day);
        regularity.ifPresent(r -> {
            // Per la regolarita' `components` e' un oggetto con le due misure, non un elenco di pesi.
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("variationMin", r.variationMin());
            detail.put("weekendGapMin", r.weekendGapMin());
            scores.put("sleep_regularity", new ScoreRow(day.toString(), "sleep_regularity", version, r.score(), write(detail)));
        });

        Optional<ScoreResult> sleep = Optional.empty();
        if (features.containsKey(Features.ASLEEP_MIN)) {
            SleepNight night = new SleepNight(
                    features.get(Features.DEEP_MIN).intValue(),
                    features.get(Features.LIGHT_MIN).intValue(),
                    features.get(Features.REM_MIN).intValue(),
                    features.get(Features.AWAKE_MIN).intValue(),
                    features.get(Features.AWAKENINGS).intValue());
            sleep = SleepIndex.compute(
                    night, settings.sleepGoalMinutes(), regularity.map(SleepRegularity.Result::score).orElse(null),
                    deviations.get(Features.MIN_HR));
        }
        sleep.ifPresent(r -> scores.put("sleep", scoreRow(day, "sleep", r)));

        // Come Movimento, lo Stress si calcola a giornata finita: oggi non ha un indice.
        StressRhythm.compute(stressReadings).ifPresent(r -> scores.put("stress", scoreRow(day, "stress", r)));

        RecoveryScore.compute(
                        deviations.get(Features.HRV_NIGHT),
                        deviations.get(Features.RESTING_HR),
                        deviations.get(Features.TEMP_NIGHT),
                        sleep.map(ScoreResult::value).orElse(null),
                        // Il Recupero usa lo Stress di ieri; senza, il suo peso si ridistribuisce sugli altri segnali.
                        previousDayStress(deviceId, day))
                .ifPresent(r -> scores.put("recovery", scoreRow(day, "recovery", r)));

        // Il giorno in corso non ha indice Movimento: si calcola a giornata finita.
        if (day.isBefore(today()) && features.containsKey(Features.STEPS)) {
            int[] byHour = FeatureExtractor.stepsByHour(data.daySteps(), settings.zone());
            MovementIndex.compute(new MovementIndex.Day(
                            features.get(Features.STEPS).intValue(),
                            settings.stepsGoal(),
                            byHour,
                            features.getOrDefault(Features.HR_MINUTES, 0.0).intValue()))
                    .ifPresent(r -> scores.put("movement", scoreRow(day, "movement", r)));
        }

        sleepDebt(deviceId, day, features).ifPresent(m -> metrics.put("sleep_debt", m));
        strain(day, deviations).ifPresent(m -> metrics.put("strain_level", m));
        breathing(deviceId, day, data).ifPresent(m -> metrics.put("spo2_night", m));
        temperatureDeviation(day, features, baselines).ifPresent(m -> metrics.put("temp_deviation", m));

        long now = clock.millis();
        repository.replaceScores(deviceId, day, version, scores, now);
        repository.replaceMetrics(deviceId, day, version, metrics, now);
    }

    // --- caricamento ---

    private DayData load(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        SessionRow row = repository.longestSessionEnding(deviceId, from, to);
        Session sleep = null;
        List<Sample> none = List.of();
        List<Sample> nightHr = none;
        List<Sample> nightHrv = none;
        List<Sample> nightTemp = none;
        List<Sample> nightSpo2 = none;
        if (row != null) {
            sleep = new Session(row.startMs(), row.endMs(), repository.stages(row.id()));
            nightHr = repository.samples(deviceId, "HR", row.startMs(), row.endMs());
            nightHrv = repository.samples(deviceId, "HRV", row.startMs(), row.endMs());
            nightTemp = repository.samples(deviceId, "TEMP", row.startMs(), row.endMs());
            nightSpo2 = repository.samples(deviceId, "SPO2", row.startMs(), row.endMs());
        }
        return new DayData(
                day, settings.zone(), sleep, nightHr, nightHrv, nightTemp, nightSpo2,
                repository.samples(deviceId, "HR", from, to), repository.samples(deviceId, "STEPS", from, to));
    }

    // --- stress ---

    private List<StressRhythm.Reading> stressReadings(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        return repository.samples(deviceId, "STRESS", from, to).stream()
                .map(s -> {
                    java.time.ZonedDateTime local = java.time.Instant.ofEpochMilli(s.ts()).atZone(settings.zone());
                    return new StressRhythm.Reading(local.getHour() * 60 + local.getMinute(), s.value());
                })
                .toList();
    }

    /** L'indice Stress di ieri, gia' calcolato perche' il ricalcolo procede dal giorno piu' vecchio al piu' recente. */
    private Integer previousDayStress(String deviceId, LocalDate day) {
        LocalDate previous = day.minusDays(1);
        return repository.scores(deviceId, previous, previous, ScoreResult.V1).stream()
                .filter(row -> "stress".equals(row.kind()))
                .map(DailyRepository.ScoreRow::value)
                .findFirst()
                .orElse(null);
    }

    // --- formule che guardano piu' giorni ---

    private Optional<SleepRegularity.Result> regularity(String deviceId, LocalDate day) {
        Map<LocalDate, Double> midpoints =
                repository.featureSeries(deviceId, Features.MIDPOINT_MIN, day.minusDays(REGULARITY_NIGHTS - 1L), day);
        List<SleepRegularity.Night> nights = new ArrayList<>();
        midpoints.forEach((d, midpoint) -> nights.add(new SleepRegularity.Night(midpoint, isWeekend(d))));
        return SleepRegularity.compute(nights);
    }

    private static boolean isWeekend(LocalDate day) {
        return day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    private Optional<MetricRow> sleepDebt(String deviceId, LocalDate day, Map<String, Double> todayFeatures) {
        Map<LocalDate, Double> asleep = repository.featureSeries(deviceId, Features.ASLEEP_MIN, day.minusDays(6), day);
        List<Integer> minutes = new ArrayList<>();
        for (int i = 6; i >= 0; i--) {
            Double value = asleep.get(day.minusDays(i));
            minutes.add(value == null ? null : value.intValue());
        }
        OptionalDouble hours = SleepDebt.hours(minutes, settings.sleepGoalMinutes());
        return hours.isEmpty() ? Optional.empty() : Optional.of(metric(day, "sleep_debt", hours.getAsDouble(), "h", null));
    }

    private Optional<MetricRow> strain(LocalDate day, Map<String, Double> deviations) {
        StrainSignals.Result result = StrainSignals.evaluate(
                deviations.get(Features.RESTING_HR), deviations.get(Features.HRV_NIGHT), deviations.get(Features.TEMP_NIGHT),
                List.of());
        if (result.level() == null) {
            // Nessuna baseline per tutti e tre i segnali: calibrazione in corso, niente riga.
            return Optional.empty();
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("level", result.level().name().toLowerCase());
        detail.put("count", result.count());
        return Optional.of(metric(day, "strain_level", (double) result.level().ordinal(), "level", write(detail)));
    }

    private Optional<MetricRow> breathing(String deviceId, LocalDate day, DayData data) {
        if (data.sleep() == null) {
            return Optional.empty();
        }
        List<Double> previous = new ArrayList<>(
                repository.featureSeries(deviceId, Features.SPO2_MEDIAN, day.minusDays(Baseline.WINDOW_DAYS), day.minusDays(1)).values());
        NightBreathing.Result result = NightBreathing.evaluate(FeatureExtractor.values(data.nightSpo2()), previous);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("status", result.status().name().toLowerCase());
        detail.put("count", result.count());
        detail.put("streak", result.streak());
        if (result.min() != null) {
            detail.put("min", result.min());
        }
        if (result.deviation() != null) {
            detail.put("deviation", Math.round(result.deviation() * 100) / 100.0);
        }
        return Optional.of(metric(day, "spo2_night", result.median(), "%", write(detail)));
    }

    private Optional<MetricRow> temperatureDeviation(LocalDate day, Map<String, Double> features, Map<String, BaselineRow> baselines) {
        BaselineRow baseline = baselines.get(Features.TEMP_NIGHT);
        if (baseline == null || !features.containsKey(Features.TEMP_NIGHT)) {
            return Optional.empty();
        }
        double deviation = features.get(Features.TEMP_NIGHT) - baseline.median();
        return Optional.of(metric(day, "temp_deviation", Math.round(deviation * 100) / 100.0, "C", null));
    }

    // --- scrittura ---

    private ScoreRow scoreRow(LocalDate day, String kind, ScoreResult result) {
        List<Map<String, Object>> components = new ArrayList<>();
        for (ScoreResult.Component c : result.components()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", c.id());
            entry.put("weight", c.weight());
            entry.put("score", c.score());
            components.add(entry);
        }
        return new ScoreRow(day.toString(), kind, result.algoVersion(), result.value(), write(components));
    }

    private static MetricRow metric(LocalDate day, String name, Double value, String unit, String detail) {
        return new MetricRow(day.toString(), name, ScoreResult.V1, value, unit, detail);
    }

    private String write(Object value) {
        return json.writeValueAsString(value);
    }
}
