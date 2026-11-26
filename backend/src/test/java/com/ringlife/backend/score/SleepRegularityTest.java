package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.SleepRegularity.Night;

class SleepRegularityTest {

    private static List<Night> nights(int weekendFrom, double... midpoints) {
        Night[] result = new Night[midpoints.length];
        for (int i = 0; i < midpoints.length; i++) {
            result[i] = new Night(midpoints[i], i >= weekendFrom);
        }
        return Arrays.asList(result);
    }

    @Test
    void sameMidpointEveryNightIsOneHundred() {
        assertThat(SleepRegularity.compute(nights(5, 180, 180, 180, 180, 180, 180, 180)).orElseThrow().score()).isEqualTo(100);
    }

    @Test
    void needsAtLeastFiveNights() {
        assertThat(SleepRegularity.compute(nights(99, 180, 180, 180, 180))).isEmpty();
        assertThat(SleepRegularity.compute(nights(99, 180, 180, 180, 180, 180))).isPresent();
    }

    @Test
    void aNinetyMinuteSwingLowersTheScore() {
        SleepRegularity.Result swing = SleepRegularity.compute(nights(99, 180, 270, 180, 270, 180, 270, 180)).orElseThrow();
        assertThat(swing.score()).isLessThan(75);
        assertThat(swing.variationMin()).isGreaterThan(35);
    }

    @Test
    void aWeekendShiftedByTwoHoursIsPenalisedEvenWithConstantWeekdays() {
        SleepRegularity.Result shifted = SleepRegularity.compute(nights(5, 180, 180, 180, 180, 180, 300, 300)).orElseThrow();
        assertThat(shifted.weekendGapMin()).isEqualTo(120);
        assertThat(shifted.score()).isLessThan(100);
    }

    @Test
    void withFewerThanTwoWeekendNightsOnlyConstancyCounts() {
        SleepRegularity.Result oneWeekendNight = SleepRegularity.compute(nights(6, 180, 180, 180, 180, 180, 180, 300)).orElseThrow();
        assertThat(oneWeekendNight.weekendGapMin()).isNull();
        SleepRegularity.Result none = SleepRegularity.compute(nights(99, 180, 180, 180, 180, 300, 180, 180)).orElseThrow();
        assertThat(none.weekendGapMin()).isNull();
    }

    @Test
    void midpointsBeforeMidnightWork() {
        assertThat(SleepRegularity.compute(nights(99, -30, -30, -30, -30, -30)).orElseThrow().score()).isEqualTo(100);
    }

    @Test
    void theSampleWeekGivesFiftyTwo() {
        // Gli stessi dati dell'app mobile: la settimana sintetica con sabato e domenica piu' tardi.
        SleepRegularity.Result result = SleepRegularity.compute(List.of(
                        new Night(190, false), new Night(180, false), new Night(200, false), new Night(250, true),
                        new Night(265, true), new Night(185, false), new Night(150, false)))
                .orElseThrow();
        assertThat(result.score()).isEqualTo(52);
        assertThat(result.variationMin()).isEqualTo(38);
        assertThat(result.weekendGapMin()).isEqualTo(77);
    }
}
