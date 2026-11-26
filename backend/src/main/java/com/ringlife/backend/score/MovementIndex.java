package com.ringlife.backend.score;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import com.ringlife.backend.score.ScoreResult.Component;

/**
 * Movement Index v1 di un giorno intero (docs/scores.md): passi 40%, ore attive 30%, minuti di sforzo 20%,
 * assenza di pause lunghe 10%. Il giorno in corso non ha indice.
 */
public final class MovementIndex {

    private MovementIndex() {}

    public static final String STEPS = "move-steps";
    public static final String ACTIVE_HOURS = "move-active-hours";
    public static final String HR_MINUTES = "move-hr-minutes";
    public static final String SEDENTARY = "move-sedentary";

    /** Passi in un'ora per contarla attiva. */
    public static final int ACTIVE_HOUR_STEPS = 250;
    static final int ACTIVE_HOURS_TARGET = 10;
    static final int HR_MINUTES_TARGET = 30;
    /** Le pause contano dalle 07:00 alle 23:00 (ore 7..22). */
    static final int WAKING_FROM = 7;
    static final int WAKING_TO = 23;
    static final int LONG_STRETCH_HOURS = 2;
    static final double POINTS_PER_STRETCH_HOUR = 12.5;

    /** Una pausa lunga: dall'ora `from` (inclusa) all'ora `to` (esclusa). */
    public record Stretch(int from, int to) {}

    /** @param stepsByHour 24 valori, uno per ora dalla mezzanotte (ora locale) */
    public record Day(int steps, int stepsGoal, int[] stepsByHour, int hrMinutes) {}

    public static int activeHours(int[] stepsByHour) {
        int hours = 0;
        for (int steps : stepsByHour) {
            if (steps >= ACTIVE_HOUR_STEPS) {
                hours++;
            }
        }
        return hours;
    }

    /** Pause di almeno 2 ore di fila con meno di 250 passi all'ora, tra le 07:00 e le 23:00. */
    public static List<Stretch> sedentaryStretches(int[] stepsByHour) {
        List<Stretch> stretches = new ArrayList<>();
        int start = -1;
        for (int hour = WAKING_FROM; hour <= WAKING_TO; hour++) {
            boolean idle = hour < WAKING_TO && hour < stepsByHour.length && stepsByHour[hour] < ACTIVE_HOUR_STEPS;
            if (idle && start < 0) {
                start = hour;
            } else if (!idle && start >= 0) {
                if (hour - start >= LONG_STRETCH_HOURS) {
                    stretches.add(new Stretch(start, hour));
                }
                start = -1;
            }
        }
        return stretches;
    }

    public static Optional<ScoreResult> compute(Day day) {
        if (day.stepsByHour().length != 24) {
            throw new IllegalArgumentException("Servono 24 valori orari");
        }
        int stretchHours = sedentaryStretches(day.stepsByHour()).stream().mapToInt(s -> s.to() - s.from()).sum();
        List<Component> components = List.of(
                ScoreResult.component(STEPS, 0.40, ScoreResult.ratioScore(day.steps(), day.stepsGoal())),
                ScoreResult.component(
                        ACTIVE_HOURS, 0.30, ScoreResult.ratioScore(activeHours(day.stepsByHour()), ACTIVE_HOURS_TARGET)),
                ScoreResult.component(HR_MINUTES, 0.20, ScoreResult.ratioScore(day.hrMinutes(), HR_MINUTES_TARGET)),
                ScoreResult.component(
                        SEDENTARY, 0.10,
                        Stats.round(Stats.clamp(100 - POINTS_PER_STRETCH_HOUR * stretchHours, 0, 100))));
        return ScoreResult.combine(components);
    }
}
