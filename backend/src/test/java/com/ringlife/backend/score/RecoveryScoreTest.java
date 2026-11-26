package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class RecoveryScoreTest {

    private static List<Integer> scores(ScoreResult result) {
        return result.components().stream().map(c -> c.score()).toList();
    }

    @Test
    void scoresTheSampleDay() {
        // Gli stessi valori dell'app mobile: HRV -1,5, battito +0,8, temperatura 0, Sonno 62, Stress 74.
        ScoreResult result = RecoveryScore.compute(-1.5, 0.8, 0.0, 62, 74).orElseThrow();
        assertThat(scores(result)).containsExactly(56, 65, 75, 62, 74);
        assertThat(result.value()).isEqualTo(64);
        assertThat(result.algoVersion()).isEqualTo("v1");
    }

    @Test
    void everythingOnYourAverageIsSeventyFive() {
        assertThat(RecoveryScore.compute(0.0, 0.0, 0.0, 75, 75).orElseThrow().value()).isEqualTo(75);
    }

    @Test
    void aHigherHrvIsBetterButAHigherRestingHeartRateIsWorse() {
        int better = RecoveryScore.compute(2.0, 0.0, 0.0, 75, 75).orElseThrow().value();
        int worse = RecoveryScore.compute(-2.0, 0.0, 0.0, 75, 75).orElseThrow().value();
        assertThat(better).isGreaterThan(worse);

        int calmHeart = RecoveryScore.compute(0.0, -2.0, 0.0, 75, 75).orElseThrow().value();
        int fastHeart = RecoveryScore.compute(0.0, 2.0, 0.0, 75, 75).orElseThrow().value();
        assertThat(calmHeart).isGreaterThan(fastHeart);

        int cool = RecoveryScore.compute(0.0, 0.0, -2.0, 75, 75).orElseThrow().value();
        int warm = RecoveryScore.compute(0.0, 0.0, 2.0, 75, 75).orElseThrow().value();
        assertThat(cool).isGreaterThan(warm);
    }

    @Test
    void hrvWeighsMoreThanStress() {
        int lowHrv = RecoveryScore.compute(-3.0, 0.0, 0.0, 75, 75).orElseThrow().value();
        int lowStress = RecoveryScore.compute(0.0, 0.0, 0.0, 75, 0).orElseThrow().value();
        assertThat(lowHrv).isLessThan(lowStress);
    }

    @Test
    void aMissingSignalRedistributesItsWeight() {
        ScoreResult noTemp = RecoveryScore.compute(-1.5, 0.8, null, 62, 74).orElseThrow();
        assertThat(noTemp.components().get(2).missing()).isTrue();
        assertThat(noTemp.value()).isBetween(60, 64);
    }

    @Test
    void withTooLittleDataThereIsNoScore() {
        // Mancano HRV e battito (60% del peso): resta meno della meta'.
        assertThat(RecoveryScore.compute(null, null, 0.0, 62, 74)).isEmpty();
        assertThat(RecoveryScore.compute(null, null, null, null, null)).isEmpty();
    }

    @Test
    void deviationsAreLimited() {
        int extreme = RecoveryScore.compute(3.0, -3.0, -3.0, 100, 100).orElseThrow().value();
        assertThat(extreme).isEqualTo(100);
        int floor = RecoveryScore.compute(-3.0, 3.0, 3.0, 0, 0).orElseThrow().value();
        // Ogni scostamento limitato a -3 vale 38 punti: l'indice non scende a 0 solo per questo.
        assertThat(floor).isBetween(0, 30);
    }
}
