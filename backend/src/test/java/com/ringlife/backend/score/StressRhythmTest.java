package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.StressRhythm.Reading;

class StressRhythmTest {

    private static int at(int hour, int minute) {
        return hour * 60 + minute;
    }

    /** Un campione ogni 30 minuti tra le due ore, con lo stesso valore. */
    private static List<Reading> every30(int fromHour, int toHour, double value) {
        List<Reading> readings = new ArrayList<>();
        for (int minute = at(fromHour, 0); minute < at(toHour, 0); minute += 30) {
            readings.add(new Reading(minute, value));
        }
        return readings;
    }

    private static List<Reading> concat(List<Reading> a, List<Reading> b) {
        List<Reading> all = new ArrayList<>(a);
        all.addAll(b);
        return all;
    }

    @Test
    void aCalmDayScoresFull() {
        // Sempre 20: nessun campione alto, nessun cambio tra giorno e sera.
        ScoreResult result = StressRhythm.compute(every30(7, 23, 20)).orElseThrow();
        assertThat(result.components()).extracting(c -> c.id()).containsExactly("stress-load", "stress-evening");
        assertThat(result.components().get(0).score()).isEqualTo(100);
        // Nessun calo serale: 50, ne' meglio ne' peggio.
        assertThat(result.components().get(1).score()).isEqualTo(50);
        assertThat(result.value()).isEqualTo(85);
    }

    @Test
    void halfTheDayAtHighStressZeroesTheLoad() {
        List<Reading> readings = concat(every30(7, 15, 80), every30(15, 23, 30));
        assertThat(StressRhythm.compute(readings).orElseThrow().components().get(0).score()).isZero();
    }

    @Test
    void aQuarterOfTheDayHighHalvesTheLoad() {
        // 8 ore su 32 mezz'ore: 4 ore alte, un quarto dei campioni.
        List<Reading> readings = concat(every30(7, 11, 80), every30(11, 23, 30));
        assertThat(StressRhythm.compute(readings).orElseThrow().components().get(0).score()).isEqualTo(50);
    }

    @Test
    void theThresholdItselfCountsAsHigh() {
        List<Reading> readings = concat(every30(7, 15, StressRhythm.HIGH), every30(15, 23, 10));
        assertThat(StressRhythm.compute(readings).orElseThrow().components().get(0).score()).isZero();
    }

    @Test
    void aCalmerEveningScoresBetterThanTheDay() {
        List<Reading> readings = concat(every30(7, 19, 50), every30(19, 23, 30));
        // Calo di 20 punti: punteggio pieno per il recupero.
        assertThat(StressRhythm.compute(readings).orElseThrow().components().get(1).score()).isEqualTo(100);
    }

    @Test
    void aMoreStressedEveningScoresWorse() {
        List<Reading> readings = concat(every30(7, 19, 30), every30(19, 23, 50));
        assertThat(StressRhythm.compute(readings).orElseThrow().components().get(1).score()).isZero();
    }

    @Test
    void ignoresReadingsOutsideTheWakingHours() {
        List<Reading> night = every30(0, 7, 90);
        night.addAll(every30(23, 24, 90));
        List<Reading> all = concat(night, every30(7, 23, 20));
        assertThat(StressRhythm.compute(all)).isEqualTo(StressRhythm.compute(every30(7, 23, 20)));
    }

    @Test
    void tooFewDaytimeReadingsMeanNoIndex() {
        assertThat(StressRhythm.compute(every30(7, 11, 20))).isPresent(); // 8 campioni: bastano
        assertThat(StressRhythm.compute(every30(7, 10, 20))).isEmpty(); // 6 campioni: no
        assertThat(StressRhythm.compute(List.of())).isEmpty();
    }

    @Test
    void withoutEnoughEveningReadingsOnlyTheLoadCounts() {
        // 12 ore di giorno, ma la sera ha solo 2 campioni: il recupero manca e il carico vale da solo.
        List<Reading> readings = concat(every30(7, 19, 20), List.of(new Reading(at(20, 0), 20), new Reading(at(21, 0), 20)));
        ScoreResult result = StressRhythm.compute(readings).orElseThrow();
        assertThat(result.components().get(1).score()).isNull();
        assertThat(result.value()).isEqualTo(100);
    }

    @Test
    void theWeightsAreSeventyAndThirty() {
        ScoreResult result = StressRhythm.compute(every30(7, 23, 20)).orElseThrow();
        assertThat(result.components()).extracting(c -> c.weight()).containsExactly(0.7, 0.3);
        assertThat(result.algoVersion()).isEqualTo("v1");
    }
}
