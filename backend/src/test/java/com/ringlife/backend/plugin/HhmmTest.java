package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HhmmTest {

    @Test
    void parsesAndFormatsClockTimes() {
        assertThat(Hhmm.minutes("00:00")).isZero();
        assertThat(Hhmm.minutes("07:30")).isEqualTo(450);
        assertThat(Hhmm.minutes("23:59")).isEqualTo(1439);
        assertThat(Hhmm.format(450)).isEqualTo("07:30");
    }

    @Test
    void formatsWrapAroundTwentyFourHours() {
        assertThat(Hhmm.format(1500)).isEqualTo("01:00");
        assertThat(Hhmm.format(-60)).isEqualTo("23:00");
        assertThat(Hhmm.format(1440)).isEqualTo("00:00");
    }

    @Test
    void theCircularDifferenceTakesTheShortWayRoundTheClock() {
        assertThat(Hhmm.circularDiff(10, 0)).isEqualTo(10);
        assertThat(Hhmm.circularDiff(0, 10)).isEqualTo(-10);
        // 23:50 contro 00:10: sono 20 minuti, non 1420.
        assertThat(Hhmm.circularDiff(-10, 10)).isEqualTo(-20);
        assertThat(Hhmm.circularDiff(1430, 10)).isEqualTo(-20);
        assertThat(Hhmm.circularDiff(10, 1430)).isEqualTo(20);
        assertThat(Hhmm.circularDiff(300, 300)).isZero();
    }
}
