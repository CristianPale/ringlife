package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

class SleepDebtTest {

    private static final int GOAL = 480;

    private static List<Integer> days(Integer... minutes) {
        return Arrays.asList(minutes);
    }

    @Test
    void noDebtWhenEveryNightMeetsTheGoal() {
        assertThat(SleepDebt.hours(days(480, 480, 480, 480, 480, 480, 480), GOAL).getAsDouble()).isZero();
        assertThat(SleepDebt.hours(days(540, 500, 480, 600, 480, 480, 480), GOAL).getAsDouble()).isZero();
    }

    @Test
    void anHourShortEveryDayIsSevenHours() {
        assertThat(SleepDebt.hours(days(420, 420, 420, 420, 420, 420, 420), GOAL).getAsDouble()).isCloseTo(7, within(1e-9));
    }

    @Test
    void recentNightsWeighMore() {
        double onlyOldest = SleepDebt.hours(days(420, 480, 480, 480, 480, 480, 480), GOAL).getAsDouble();
        double onlyLatest = SleepDebt.hours(days(480, 480, 480, 480, 480, 480, 420), GOAL).getAsDouble();
        assertThat(onlyOldest).isCloseTo(0.25, within(1e-9));
        assertThat(onlyLatest).isCloseTo(1.75, within(1e-9));
    }

    @Test
    void anExtraHourOfSleepDoesNotPayOffAnotherNight() {
        double debt = SleepDebt.hours(days(600, 420, 480, 480, 480, 480, 480), GOAL).getAsDouble();
        assertThat(debt).isCloseTo(0.5, within(1e-9));
    }

    @Test
    void daysWithoutDataAreIgnored() {
        double debt = SleepDebt.hours(days(null, null, 420, null, 480, 480, 480), GOAL).getAsDouble();
        assertThat(debt).isCloseTo(0.75, within(1e-9));
    }

    @Test
    void noDataAtAllMeansNoDebtValue() {
        assertThat(SleepDebt.hours(days(null, null, null, null, null, null, null), GOAL)).isEmpty();
    }

    @Test
    void followsTheGoal() {
        double eight = SleepDebt.hours(days(420, 420, 420, 420, 420, 420, 420), 480).getAsDouble();
        double seven = SleepDebt.hours(days(420, 420, 420, 420, 420, 420, 420), 420).getAsDouble();
        assertThat(eight).isGreaterThan(seven);
        assertThat(seven).isZero();
    }

    @Test
    void needsExactlySevenDays() {
        assertThatThrownBy(() -> SleepDebt.hours(days(480, 480), GOAL)).isInstanceOf(IllegalArgumentException.class);
    }
}
