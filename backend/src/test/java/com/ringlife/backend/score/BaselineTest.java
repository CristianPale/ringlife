package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

class BaselineTest {

    private static List<Double> constant(int n, double value) {
        return IntStream.range(0, n).mapToObj(i -> value).toList();
    }

    @Test
    void needsAtLeastSevenDays() {
        assertThat(Baseline.of(constant(6, 50), 1)).isEmpty();
        assertThat(Baseline.of(constant(7, 50), 1)).isPresent();
        assertThat(Baseline.of(List.of(), 1)).isEmpty();
    }

    @Test
    void usesTheMedianAndTheMadOfTheWindow() {
        Baseline baseline = Baseline.of(Stats.boxed(1, 2, 3, 4, 5, 6, 7, 8, 9), 0.1).orElseThrow();
        assertThat(baseline.median()).isEqualTo(5);
        assertThat(baseline.mad()).isEqualTo(2);
        // dev = (x - mediana) / (1,4826 * MAD)
        assertThat(baseline.deviation(7)).isCloseTo(2 / (1.4826 * 2), within(1e-9));
        assertThat(baseline.deviation(3)).isCloseTo(-2 / (1.4826 * 2), within(1e-9));
        assertThat(baseline.deviation(5)).isZero();
    }

    @Test
    void usesOnlyTheLast28Days() {
        List<Double> values = new ArrayList<>(constant(40, 90));
        values.addAll(constant(28, 50));
        Baseline baseline = Baseline.of(values, 1).orElseThrow();
        assertThat(baseline.count()).isEqualTo(28);
        assertThat(baseline.median()).isEqualTo(50);
    }

    @Test
    void limitsTheDeviationToPlusOrMinusThree() {
        Baseline baseline = Baseline.of(Stats.boxed(1, 2, 3, 4, 5, 6, 7, 8, 9), 0.1).orElseThrow();
        assertThat(baseline.deviation(1000)).isEqualTo(3);
        assertThat(baseline.deviation(-1000)).isEqualTo(-3);
    }

    @Test
    void aMinimumSpreadKeepsAStableSeriesFromExploding() {
        // MAD 0: senza il minimo, un solo punto in piu' varrebbe infinite volte la variabilita'.
        Baseline baseline = Baseline.of(constant(20, 96), 0.5).orElseThrow();
        assertThat(baseline.mad()).isZero();
        assertThat(baseline.deviation(95)).isCloseTo(-2, within(1e-9));
        assertThat(baseline.deviation(96)).isZero();
    }

    @Test
    void theMinimumSpreadDoesNotChangeASeriesThatAlreadyVaries() {
        Baseline wide = Baseline.of(Stats.boxed(40, 50, 60, 45, 55, 52, 48), 0.1).orElseThrow();
        Baseline floored = Baseline.of(Stats.boxed(40, 50, 60, 45, 55, 52, 48), 1).orElseThrow();
        assertThat(wide.deviation(60)).isEqualTo(floored.deviation(60));
    }
}
