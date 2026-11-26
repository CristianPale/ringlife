package com.ringlife.backend.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.score.SleepNight.Stage;

class SleepNightTest {

    private static final long MIN = 60_000L;

    private static Stage stage(String stage, long startMin, long endMin) {
        return new Stage(stage, startMin * MIN, endMin * MIN);
    }

    @Test
    void summarisesStagesIntoMinutes() {
        SleepNight night = SleepNight.fromStages(List.of(
                stage("awake", 0, 10),
                stage("light", 10, 100),
                stage("deep", 100, 160),
                stage("awake", 160, 170),
                stage("rem", 170, 230)));
        assertThat(night.deepMin()).isEqualTo(60);
        assertThat(night.lightMin()).isEqualTo(90);
        assertThat(night.remMin()).isEqualTo(60);
        assertThat(night.awakeMin()).isEqualTo(20);
        assertThat(night.asleepMin()).isEqualTo(210);
        assertThat(night.inBedMin()).isEqualTo(230);
        assertThat(night.efficiency()).isBetween(0.91, 0.92);
    }

    @Test
    void fallingAsleepIsNotAnAwakening() {
        SleepNight night = SleepNight.fromStages(List.of(
                stage("awake", 0, 15), stage("light", 15, 100), stage("awake", 100, 105), stage("deep", 105, 160)));
        assertThat(night.awakenings()).isEqualTo(1);
        assertThat(SleepNight.fromStages(List.of(stage("awake", 0, 30))).awakenings()).isZero();
    }

    @Test
    void sortsStagesBeforeCounting() {
        SleepNight night = SleepNight.fromStages(List.of(
                stage("deep", 105, 160), stage("awake", 0, 15), stage("awake", 100, 105), stage("light", 15, 100)));
        assertThat(night.awakenings()).isEqualTo(1);
    }

    @Test
    void anEmptyNightHasZeroEfficiency() {
        assertThat(new SleepNight(0, 0, 0, 0, 0).efficiency()).isZero();
    }

    @Test
    void rejectsAnUnknownStage() {
        assertThatThrownBy(() -> SleepNight.fromStages(List.of(stage("dreaming", 0, 10))))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
