package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.ringlife.backend.score.MovementIndex;
import com.ringlife.backend.score.NightBreathing;
import com.ringlife.backend.score.SleepNight;
import com.ringlife.backend.score.SleepNight.Stage;

/**
 * Estrae le feature di un giorno dai dati grezzi (ADR 0009). Funzioni pure: gli stessi dati danno le stesse feature.
 * Le ipotesi sull'anello (passi per intervallo, passo costante dei campioni di battito) sono nell'ADR.
 */
public final class FeatureExtractor {

    private FeatureExtractor() {}

    /** Campioni minimi nella notte per fidarsi di una mediana. */
    static final int MIN_HR_SAMPLES = 10;
    static final int MIN_OTHER_SAMPLES = 3;

    public record Sample(long ts, double value) {}

    public record Session(long startMs, long endMs, List<Stage> stages) {}

    /**
     * @param sleep la sessione di sonno che finisce in questo giorno, null se non c'e'
     * @param nightHr campioni di battito durante il sonno (altrettanto per HRV, temperatura, SpO2)
     * @param dayHr tutti i campioni di battito del giorno locale
     * @param daySteps tutti i campioni di passi del giorno locale
     */
    public record DayData(
            LocalDate day,
            ZoneId zone,
            Session sleep,
            List<Sample> nightHr,
            List<Sample> nightHrv,
            List<Sample> nightTemp,
            List<Sample> nightSpo2,
            List<Sample> dayHr,
            List<Sample> daySteps) {}

    public static Map<String, Double> extract(DayData data, ComputeSettings settings) {
        Map<String, Double> features = new LinkedHashMap<>();
        if (data.sleep() != null) {
            sleepFeatures(data, features);
        }
        if (!data.daySteps().isEmpty()) {
            int[] byHour = stepsByHour(data.daySteps(), data.zone());
            double total = 0;
            for (int steps : byHour) {
                total += steps;
            }
            features.put(Features.STEPS, total);
            features.put(Features.ACTIVE_HOURS, (double) MovementIndex.activeHours(byHour));
        }
        if (!data.dayHr().isEmpty()) {
            long active = data.dayHr().stream().filter(s -> s.value() >= settings.hrZoneThreshold()).count();
            features.put(Features.HR_MINUTES, (double) active * settings.hrSampleMinutes());
        }
        return features;
    }

    private static void sleepFeatures(DayData data, Map<String, Double> features) {
        SleepNight night = SleepNight.fromStages(data.sleep().stages());
        if (night.asleepMin() == 0) {
            return;
        }
        features.put(Features.ASLEEP_MIN, (double) night.asleepMin());
        features.put(Features.IN_BED_MIN, (double) night.inBedMin());
        features.put(Features.DEEP_MIN, (double) night.deepMin());
        features.put(Features.LIGHT_MIN, (double) night.lightMin());
        features.put(Features.REM_MIN, (double) night.remMin());
        features.put(Features.AWAKE_MIN, (double) night.awakeMin());
        features.put(Features.AWAKENINGS, (double) night.awakenings());
        long midpoint = (data.sleep().startMs() + data.sleep().endMs()) / 2;
        long dayStart = data.day().atStartOfDay(data.zone()).toInstant().toEpochMilli();
        features.put(Features.MIDPOINT_MIN, (midpoint - dayStart) / 60_000.0);
        features.put(Features.SLEEP_START_MIN, (data.sleep().startMs() - dayStart) / 60_000.0);
        features.put(Features.SLEEP_END_MIN, (data.sleep().endMs() - dayStart) / 60_000.0);

        if (data.nightHr().size() >= MIN_HR_SAMPLES) {
            List<Double> hr = values(data.nightHr());
            features.put(Features.RESTING_HR, median(hr));
            features.put(Features.MIN_HR, percentile(hr, 5));
        }
        if (data.nightHrv().size() >= MIN_OTHER_SAMPLES) {
            features.put(Features.HRV_NIGHT, median(values(data.nightHrv())));
        }
        if (data.nightTemp().size() >= MIN_OTHER_SAMPLES) {
            features.put(Features.TEMP_NIGHT, median(values(data.nightTemp())));
        }
        features.put(Features.SPO2_COUNT, (double) data.nightSpo2().size());
        if (data.nightSpo2().size() >= NightBreathing.MIN_SAMPLES) {
            List<Double> spo2 = values(data.nightSpo2());
            features.put(Features.SPO2_MEDIAN, median(spo2));
            features.put(Features.SPO2_MIN, spo2.stream().mapToDouble(Double::doubleValue).min().orElse(0));
        }
    }

    /** Passi per ora locale del giorno (24 valori). Un campione e' il numero di passi dell'intervallo che finisce a `ts`. */
    public static int[] stepsByHour(List<Sample> steps, ZoneId zone) {
        int[] byHour = new int[24];
        for (Sample sample : steps) {
            int hour = java.time.Instant.ofEpochMilli(sample.ts()).atZone(zone).getHour();
            byHour[hour] += (int) Math.round(sample.value());
        }
        return byHour;
    }

    static List<Double> values(List<Sample> samples) {
        List<Double> values = new ArrayList<>(samples.size());
        for (Sample sample : samples) {
            values.add(sample.value());
        }
        return values;
    }

    static double median(List<Double> values) {
        List<Double> sorted = values.stream().sorted().toList();
        int mid = sorted.size() / 2;
        return sorted.size() % 2 == 1 ? sorted.get(mid) : (sorted.get(mid - 1) + sorted.get(mid)) / 2;
    }

    /** Percentile per rango piu' vicino. */
    static double percentile(List<Double> values, int percent) {
        List<Double> sorted = values.stream().sorted().toList();
        int index = (int) Math.ceil(percent / 100.0 * sorted.size()) - 1;
        return sorted.get(Math.max(0, Math.min(sorted.size() - 1, index)));
    }
}
