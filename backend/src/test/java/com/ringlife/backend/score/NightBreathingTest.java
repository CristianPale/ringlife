package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.NightBreathing.Status;

class NightBreathingTest {

    private static List<Double> same(int n, double value) {
        return new ArrayList<>(Collections.nCopies(n, value));
    }

    private static List<Double> plus(List<Double> base, double... more) {
        List<Double> result = new ArrayList<>(base);
        for (double v : more) {
            result.add(v);
        }
        return result;
    }

    @Test
    void aNormalNightIsOnTrack() {
        NightBreathing.Result result = NightBreathing.evaluate(same(30, 96), same(30, 96));
        assertThat(result.status()).isEqualTo(Status.OK);
        assertThat(result.median()).isEqualTo(96);
        assertThat(result.streak()).isZero();
    }

    @Test
    void fewerThanTenSamplesIsInsufficient() {
        NightBreathing.Result result = NightBreathing.evaluate(same(9, 96), same(30, 96));
        assertThat(result.status()).isEqualTo(Status.INSUFFICIENT);
        assertThat(result.count()).isEqualTo(9);
        assertThat(result.median()).isNull();
    }

    @Test
    void withoutSevenPreviousNightsItIsCalibrating() {
        assertThat(NightBreathing.evaluate(same(30, 96), same(6, 96)).status()).isEqualTo(Status.CALIBRATING);
        assertThat(NightBreathing.evaluate(same(30, 96), List.of()).status()).isEqualTo(Status.CALIBRATING);
    }

    @Test
    void oneOrTwoLowNightsAreNotFlagged() {
        assertThat(NightBreathing.evaluate(same(30, 93), same(30, 96)).status()).isEqualTo(Status.OK);
        NightBreathing.Result two = NightBreathing.evaluate(same(30, 93), plus(same(30, 96), 93));
        assertThat(two.status()).isEqualTo(Status.OK);
        assertThat(two.streak()).isEqualTo(2);
    }

    @Test
    void threeLowNightsInARowAreFlagged() {
        NightBreathing.Result result = NightBreathing.evaluate(same(30, 93), plus(same(30, 96), 93, 93));
        assertThat(result.status()).isEqualTo(Status.WATCH);
        assertThat(result.streak()).isEqualTo(3);
    }

    @Test
    void lowNightsThatAreNotConsecutiveAreNotFlagged() {
        assertThat(NightBreathing.evaluate(same(30, 93), plus(same(30, 96), 93, 96)).status()).isEqualTo(Status.OK);
        assertThat(NightBreathing.evaluate(same(30, 96), plus(same(30, 96), 93, 93)).status()).isEqualTo(Status.OK);
    }

    @Test
    void thereIsNoAbsoluteThreshold() {
        assertThat(NightBreathing.evaluate(same(30, 92), same(40, 92)).status()).isEqualTo(Status.OK);
    }

    @Test
    void aLowMinimumWithANormalMedianIsNotFlagged() {
        List<Double> samples = same(29, 96);
        samples.add(85.0);
        NightBreathing.Result result = NightBreathing.evaluate(samples, same(30, 96));
        assertThat(result.status()).isEqualTo(Status.OK);
        assertThat(result.min()).isEqualTo(85);
    }
}
