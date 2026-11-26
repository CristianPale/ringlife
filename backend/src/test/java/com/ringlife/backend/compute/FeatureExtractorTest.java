package com.ringlife.backend.compute;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.compute.FeatureExtractor.DayData;
import com.ringlife.backend.compute.FeatureExtractor.Sample;
import com.ringlife.backend.compute.FeatureExtractor.Session;
import com.ringlife.backend.score.SleepNight.Stage;

class FeatureExtractorTest {

    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 3);
    private static final long MIN = 60_000L;
    private static final ComputeSettings SETTINGS = new ComputeSettings(ROME, 480, 8000, 100, 5);
    private static final long MIDNIGHT = DAY.atStartOfDay(ROME).toInstant().toEpochMilli();

    private static List<Sample> samples(long start, int count, long stepMs, double value) {
        List<Sample> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            list.add(new Sample(start + i * stepMs, value));
        }
        return list;
    }

    /** Sonno dalle 23:30 del giorno prima alle 07:00: 450 minuti. */
    private static Session night() {
        long start = MIDNIGHT - 30 * MIN;
        long end = MIDNIGHT + 7 * 60 * MIN;
        return new Session(start, end, List.of(
                new Stage("awake", start, start + 10 * MIN),
                new Stage("light", start + 10 * MIN, start + 130 * MIN),
                new Stage("deep", start + 130 * MIN, start + 200 * MIN),
                new Stage("awake", start + 200 * MIN, start + 205 * MIN),
                new Stage("rem", start + 205 * MIN, start + 300 * MIN),
                new Stage("light", start + 300 * MIN, end)));
    }

    private static DayData data(Session sleep, List<Sample> nightHr, List<Sample> hrv, List<Sample> temp, List<Sample> spo2,
            List<Sample> dayHr, List<Sample> steps) {
        return new DayData(DAY, ROME, sleep, nightHr, hrv, temp, spo2, dayHr, steps);
    }

    private static DayData empty() {
        return data(null, List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }

    @Test
    void anEmptyDayHasNoFeatures() {
        assertThat(FeatureExtractor.extract(empty(), SETTINGS)).isEmpty();
    }

    @Test
    void summarisesTheSleepSession() {
        Map<String, Double> f = FeatureExtractor.extract(
                data(night(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.IN_BED_MIN)).isEqualTo(450);
        assertThat(f.get(Features.ASLEEP_MIN)).isEqualTo(435);
        assertThat(f.get(Features.DEEP_MIN)).isEqualTo(70);
        assertThat(f.get(Features.REM_MIN)).isEqualTo(95);
        assertThat(f.get(Features.AWAKE_MIN)).isEqualTo(15);
        assertThat(f.get(Features.AWAKENINGS)).isEqualTo(1);
    }

    @Test
    void theMidpointIsMeasuredFromLocalMidnightOfTheWakeDay() {
        // 23:30 -> 07:00: punto medio alle 03:15 = 195 minuti dopo la mezzanotte.
        Map<String, Double> f = FeatureExtractor.extract(
                data(night(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.MIDPOINT_MIN)).isEqualTo(195.0);
    }

    @Test
    void aMidpointBeforeMidnightIsNegative() {
        long start = MIDNIGHT - 5 * 60 * MIN;
        long end = MIDNIGHT + 60 * MIN;
        Session early = new Session(start, end, List.of(new Stage("light", start, end)));
        Map<String, Double> f = FeatureExtractor.extract(
                data(early, List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.MIDPOINT_MIN)).isEqualTo(-120.0);
    }

    @Test
    void nightHeartRateNeedsTenSamples() {
        long start = MIDNIGHT - 30 * MIN;
        List<Sample> nine = samples(start, 9, 5 * MIN, 52);
        assertThat(FeatureExtractor.extract(data(night(), nine, List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS))
                .doesNotContainKey(Features.RESTING_HR);
        List<Sample> ten = samples(start, 10, 5 * MIN, 52);
        Map<String, Double> f = FeatureExtractor.extract(
                data(night(), ten, List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.RESTING_HR)).isEqualTo(52.0);
    }

    @Test
    void restingHeartRateIsTheMedianAndTheMinimumIsTheFifthPercentile() {
        long start = MIDNIGHT - 30 * MIN;
        List<Sample> hr = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            hr.add(new Sample(start + i * 5 * MIN, 40 + i)); // 40..59
        }
        Map<String, Double> f = FeatureExtractor.extract(
                data(night(), hr, List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.RESTING_HR)).isEqualTo(49.5);
        assertThat(f.get(Features.MIN_HR)).isEqualTo(40.0);
    }

    @Test
    void hrvAndTemperatureNeedThreeSamples() {
        long start = MIDNIGHT - 30 * MIN;
        Map<String, Double> few = FeatureExtractor.extract(
                data(night(), List.of(), samples(start, 2, 30 * MIN, 50), samples(start, 2, 30 * MIN, 36.2), List.of(), List.of(), List.of()),
                SETTINGS);
        assertThat(few).doesNotContainKeys(Features.HRV_NIGHT, Features.TEMP_NIGHT);
        Map<String, Double> enough = FeatureExtractor.extract(
                data(night(), List.of(), samples(start, 3, 30 * MIN, 50), samples(start, 3, 30 * MIN, 36.2), List.of(), List.of(), List.of()),
                SETTINGS);
        assertThat(enough.get(Features.HRV_NIGHT)).isEqualTo(50.0);
        assertThat(enough.get(Features.TEMP_NIGHT)).isEqualTo(36.2);
    }

    @Test
    void spo2KeepsTheCountEvenWhenTooFewSamplesForAMedian() {
        long start = MIDNIGHT - 30 * MIN;
        Map<String, Double> f = FeatureExtractor.extract(
                data(night(), List.of(), List.of(), List.of(), samples(start, 6, 15 * MIN, 96), List.of(), List.of()), SETTINGS);
        assertThat(f.get(Features.SPO2_COUNT)).isEqualTo(6.0);
        assertThat(f).doesNotContainKeys(Features.SPO2_MEDIAN, Features.SPO2_MIN);
        Map<String, Double> enough = FeatureExtractor.extract(
                data(night(), List.of(), List.of(), List.of(), samples(start, 12, 15 * MIN, 96), List.of(), List.of()), SETTINGS);
        assertThat(enough.get(Features.SPO2_MEDIAN)).isEqualTo(96.0);
        assertThat(enough.get(Features.SPO2_MIN)).isEqualTo(96.0);
    }

    @Test
    void stepsAreSummedAndBucketedByLocalHour() {
        // 8:00 locale: 300 passi; 8:30: 200; 14:00: 100.
        List<Sample> steps = List.of(
                new Sample(MIDNIGHT + 8 * 60 * MIN, 300),
                new Sample(MIDNIGHT + 8 * 60 * MIN + 30 * MIN, 200),
                new Sample(MIDNIGHT + 14 * 60 * MIN, 100));
        int[] byHour = FeatureExtractor.stepsByHour(steps, ROME);
        assertThat(byHour[8]).isEqualTo(500);
        assertThat(byHour[14]).isEqualTo(100);
        Map<String, Double> f = FeatureExtractor.extract(
                data(null, List.of(), List.of(), List.of(), List.of(), List.of(), steps), SETTINGS);
        assertThat(f.get(Features.STEPS)).isEqualTo(600.0);
        assertThat(f.get(Features.ACTIVE_HOURS)).isEqualTo(1.0);
    }

    @Test
    void effortMinutesCountSamplesAtOrAboveTheThreshold() {
        List<Sample> hr = List.of(new Sample(MIDNIGHT + 1, 99), new Sample(MIDNIGHT + 2, 100), new Sample(MIDNIGHT + 3, 140));
        Map<String, Double> f = FeatureExtractor.extract(
                data(null, List.of(), List.of(), List.of(), List.of(), hr, List.of()), SETTINGS);
        assertThat(f.get(Features.HR_MINUTES)).isEqualTo(10.0);
    }

    @Test
    void aSessionWithoutSleepStagesGivesNoSleepFeatures() {
        long start = MIDNIGHT - 30 * MIN;
        Session awakeOnly = new Session(start, start + 60 * MIN, List.of(new Stage("awake", start, start + 60 * MIN)));
        assertThat(FeatureExtractor.extract(
                        data(awakeOnly, List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), SETTINGS))
                .isEmpty();
    }

    @Test
    void theSameInputGivesTheSameFeatures() {
        DayData d = data(night(), samples(MIDNIGHT - 30 * MIN, 12, 5 * MIN, 52), List.of(), List.of(), List.of(), List.of(), List.of());
        assertThat(FeatureExtractor.extract(d, SETTINGS)).isEqualTo(FeatureExtractor.extract(d, SETTINGS));
    }
}
