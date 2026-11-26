package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.ScoreResult.Component;

class SleepIndexTest {

    /** Notte sintetica: 5 h 52 di sonno, 6 h 37 a letto, 3 risvegli (la stessa dell'app mobile). */
    private static final SleepNight SAMPLE = new SleepNight(42, 248, 62, 45, 3);
    private static final int GOAL = 480;

    private static int score(ScoreResult result, String id) {
        return result.components().stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow().score();
    }

    @Test
    void scoresTheSampleNightComponentByComponent() {
        // minHrDeviation -1,0: il battito minimo e' sotto la media, quindi meglio del solito.
        ScoreResult result = SleepIndex.compute(SAMPLE, GOAL, 52, -1.0).orElseThrow();
        assertThat(result.algoVersion()).isEqualTo("v1");
        assertThat(score(result, SleepIndex.DURATION)).isEqualTo(73);
        assertThat(score(result, SleepIndex.EFFICIENCY)).isEqualTo(68);
        assertThat(score(result, SleepIndex.DEEP)).isEqualTo(80);
        assertThat(score(result, SleepIndex.REM)).isEqualTo(88);
        assertThat(score(result, SleepIndex.AWAKENINGS)).isEqualTo(48);
        assertThat(score(result, SleepIndex.REGULARITY)).isEqualTo(52);
        assertThat(score(result, SleepIndex.MIN_HR)).isEqualTo(88);
        assertThat(result.value()).isEqualTo(72);
    }

    @Test
    void weightsSumToOne() {
        ScoreResult result = SleepIndex.compute(SAMPLE, GOAL, 52, 0.0).orElseThrow();
        assertThat(result.components().stream().mapToDouble(Component::weight).sum()).isCloseTo(1.0, org.assertj.core.api.Assertions.within(1e-9));
    }

    @Test
    void aPerfectNightScoresOneHundred() {
        // 500 minuti di sonno con 20% di REM e 16% di profondo, nessun risveglio, nessun minuto sveglio.
        SleepNight perfect = new SleepNight(80, 320, 100, 0, 0);
        ScoreResult result = SleepIndex.compute(perfect, GOAL, 100, -3.0).orElseThrow();
        assertThat(score(result, SleepIndex.DURATION)).isEqualTo(100);
        assertThat(score(result, SleepIndex.EFFICIENCY)).isEqualTo(100);
        assertThat(score(result, SleepIndex.DEEP)).isEqualTo(100);
        assertThat(score(result, SleepIndex.REM)).isEqualTo(100);
        assertThat(result.value()).isEqualTo(100);
    }

    @Test
    void aLongerGoalLowersTheDurationScore() {
        int short8 = score(SleepIndex.compute(SAMPLE, 420, 52, 0.0).orElseThrow(), SleepIndex.DURATION);
        int long8 = score(SleepIndex.compute(SAMPLE, 540, 52, 0.0).orElseThrow(), SleepIndex.DURATION);
        assertThat(short8).isGreaterThan(long8);
    }

    @Test
    void aMissingSignalDoesNotZeroTheIndexButRedistributesItsWeight() {
        ScoreResult full = SleepIndex.compute(SAMPLE, GOAL, 52, 0.0).orElseThrow();
        ScoreResult noHr = SleepIndex.compute(SAMPLE, GOAL, 52, null).orElseThrow();
        assertThat(noHr.components().get(6).missing()).isTrue();
        assertThat(Math.abs(full.value() - noHr.value())).isLessThanOrEqualTo(3);
    }

    @Test
    void withoutEnoughDataThereIsNoIndex() {
        assertThat(SleepIndex.compute(new SleepNight(0, 0, 0, 30, 0), GOAL, 52, 0.0)).isEmpty();
        // Solo la durata (30%) e l'efficienza (15%) presenti: meno della meta' del peso.
        assertThat(SleepIndex.compute(SAMPLE, GOAL, null, null)).isPresent();
    }

    @Test
    void moreAwakeningsAndAwakeMinutesLowerTheScore() {
        int calm = score(SleepIndex.compute(new SleepNight(60, 280, 90, 10, 0), GOAL, 80, 0.0).orElseThrow(), SleepIndex.AWAKENINGS);
        int restless = score(SleepIndex.compute(new SleepNight(60, 280, 90, 60, 10), GOAL, 80, 0.0).orElseThrow(), SleepIndex.AWAKENINGS);
        assertThat(calm).isGreaterThan(restless);
        assertThat(restless).isZero();
    }

    @Test
    void aHigherMinimumHeartRateThanUsualLowersItsScore() {
        int low = score(SleepIndex.compute(SAMPLE, GOAL, 52, -2.0).orElseThrow(), SleepIndex.MIN_HR);
        int high = score(SleepIndex.compute(SAMPLE, GOAL, 52, 2.0).orElseThrow(), SleepIndex.MIN_HR);
        assertThat(low).isGreaterThan(high);
    }

}
