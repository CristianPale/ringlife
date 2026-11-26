package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.MovementIndex.Day;
import com.ringlife.backend.score.MovementIndex.Stretch;

class MovementIndexTest {

    /** Passi di ieri ora per ora (sintetici, gli stessi dell'app mobile): 5.470 in tutto, 11 ore attive. */
    private static final int[] YESTERDAY = {
        0, 0, 0, 0, 0, 0, 0, 180, 640, 420, 310, 120, 380, 520, 260, 140, 90, 410, 720, 480, 300, 150, 70, 280
    };

    private static int[] hours(int value) {
        int[] day = new int[24];
        Arrays.fill(day, value);
        return day;
    }

    private static int score(ScoreResult result, String id) {
        return result.components().stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow().score();
    }

    @Test
    void scoresTheSampleDay() {
        ScoreResult result = MovementIndex.compute(new Day(5470, 8000, YESTERDAY, 18)).orElseThrow();
        assertThat(score(result, MovementIndex.STEPS)).isEqualTo(68);
        assertThat(score(result, MovementIndex.ACTIVE_HOURS)).isEqualTo(100);
        assertThat(score(result, MovementIndex.HR_MINUTES)).isEqualTo(60);
        assertThat(score(result, MovementIndex.SEDENTARY)).isEqualTo(50);
        assertThat(result.value()).isEqualTo(74);
    }

    @Test
    void findsTheLongStretchesOfTheSampleDay() {
        assertThat(MovementIndex.sedentaryStretches(YESTERDAY)).containsExactly(new Stretch(15, 17), new Stretch(21, 23));
        assertThat(MovementIndex.activeHours(YESTERDAY)).isEqualTo(11);
    }

    @Test
    void aSingleIdleHourIsNotAStretch() {
        int[] day = hours(500);
        day[11] = 0;
        assertThat(MovementIndex.sedentaryStretches(day)).isEmpty();
    }

    @Test
    void aStretchNeedsTwoHoursInARow() {
        int[] day = hours(500);
        day[10] = 0;
        day[11] = 249;
        day[15] = 0;
        day[16] = 0;
        day[17] = 0;
        assertThat(MovementIndex.sedentaryStretches(day)).containsExactly(new Stretch(10, 12), new Stretch(15, 18));
    }

    @Test
    void theNightDoesNotCount() {
        int[] day = hours(500);
        for (int h : List.of(0, 1, 2, 3, 4, 5, 6, 23)) {
            day[h] = 0;
        }
        assertThat(MovementIndex.sedentaryStretches(day)).isEmpty();
    }

    @Test
    void aStretchStopsAtTwentyThree() {
        int[] day = hours(500);
        day[21] = 0;
        day[22] = 0;
        assertThat(MovementIndex.sedentaryStretches(day)).containsExactly(new Stretch(21, 23));
    }

    @Test
    void aPerfectDayIsOneHundredAndAnEmptyDayIsZero() {
        assertThat(MovementIndex.compute(new Day(12000, 8000, hours(500), 45)).orElseThrow().value()).isEqualTo(100);
        assertThat(MovementIndex.compute(new Day(0, 8000, hours(0), 0)).orElseThrow().value()).isZero();
    }

    @Test
    void followsTheStepsGoal() {
        int easy = MovementIndex.compute(new Day(5470, 5000, YESTERDAY, 18)).orElseThrow().value();
        int hard = MovementIndex.compute(new Day(5470, 12000, YESTERDAY, 18)).orElseThrow().value();
        assertThat(easy).isGreaterThan(hard);
    }

    @Test
    void anHourAt250StepsIsActive() {
        int[] day = hours(0);
        day[8] = 250;
        day[9] = 249;
        assertThat(MovementIndex.activeHours(day)).isEqualTo(1);
    }

    @Test
    void needsExactly24Hours() {
        assertThatThrownBy(() -> MovementIndex.compute(new Day(1000, 8000, new int[23], 0)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
