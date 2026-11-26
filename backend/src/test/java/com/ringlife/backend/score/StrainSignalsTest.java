package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.StrainSignals.Cause;
import com.ringlife.backend.score.StrainSignals.Level;

class StrainSignalsTest {

    private static final List<Cause> NONE = List.of();

    @Test
    void noLevelWithZeroOrOneSignal() {
        assertThat(StrainSignals.evaluate(0.0, 0.0, 0.0, NONE).level()).isEqualTo(Level.NONE);
        assertThat(StrainSignals.evaluate(3.0, 0.0, 0.0, NONE)).extracting("level", "count").containsExactly(Level.NONE, 1);
        assertThat(StrainSignals.evaluate(0.0, -3.0, 0.0, NONE).count()).isEqualTo(1);
    }

    @Test
    void attentionWithTwoSignalsWhicheverTheyAre() {
        assertThat(StrainSignals.evaluate(1.5, -1.5, 0.0, NONE).level()).isEqualTo(Level.ATTENTION);
        assertThat(StrainSignals.evaluate(1.5, 0.0, 1.5, NONE).level()).isEqualTo(Level.ATTENTION);
        assertThat(StrainSignals.evaluate(0.0, -1.5, 1.5, NONE).level()).isEqualTo(Level.ATTENTION);
    }

    @Test
    void highWithAllThree() {
        assertThat(StrainSignals.evaluate(1.5, -1.5, 1.5, NONE)).extracting("level", "count").containsExactly(Level.HIGH, 3);
    }

    @Test
    void theThresholdIsInclusive() {
        assertThat(StrainSignals.evaluate(1.0, -1.0, 0.0, NONE).count()).isEqualTo(2);
        assertThat(StrainSignals.evaluate(0.99, 0.0, 0.0, NONE).count()).isZero();
    }

    @Test
    void onlyTheDirectionOfFatigueCounts() {
        assertThat(StrainSignals.evaluate(-2.0, 2.0, -2.0, NONE)).extracting("level", "count").containsExactly(Level.NONE, 0);
    }

    @Test
    void noLevelWithoutABaselineForAllThree() {
        assertThat(StrainSignals.evaluate(2.0, -2.0, null, NONE).level()).isNull();
        assertThat(StrainSignals.evaluate(null, null, null, NONE).level()).isNull();
    }

    @Test
    void aCommonCauseIsCitedAndCapsTheLevel() {
        StrainSignals.Result high = StrainSignals.evaluate(1.5, -1.5, 1.5, List.of(Cause.ALCOHOL));
        assertThat(high.level()).isEqualTo(Level.ATTENTION);
        assertThat(high.cause()).isEqualTo(Cause.ALCOHOL);
        assertThat(StrainSignals.evaluate(1.5, -1.5, 0.0, List.of(Cause.LATE_MEAL)).cause()).isEqualTo(Cause.LATE_MEAL);
    }

    @Test
    void noCauseIsCitedWhenThereIsNothingToExplain() {
        assertThat(StrainSignals.evaluate(0.0, 0.0, 0.0, List.of(Cause.ALCOHOL)).cause()).isNull();
    }
}
