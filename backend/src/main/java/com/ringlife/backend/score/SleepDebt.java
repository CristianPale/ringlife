package com.ringlife.backend.score;

import java.util.List;
import java.util.OptionalDouble;

/**
 * Sleep Debt v1: somma sui 7 giorni di `max(0, obiettivo - sonno)`, con peso lineare crescente verso i giorni
 * recenti (1/4 per il piu' vecchio, 7/4 per il piu' recente: la media dei pesi e' 1, quindi 1 ora di deficit ogni
 * giorno vale 7 ore). In ore. I giorni senza dato non contano: non si inventa un deficit.
 */
public final class SleepDebt {

    private SleepDebt() {}

    static final int DAYS = 7;

    /**
     * @param sleepMinutesByDay minuti dormiti negli ultimi 7 giorni, dal piu' vecchio; null = giorno senza dato
     */
    public static OptionalDouble hours(List<Integer> sleepMinutesByDay, int goalMin) {
        if (sleepMinutesByDay.size() != DAYS) {
            throw new IllegalArgumentException("Servono " + DAYS + " giorni");
        }
        if (sleepMinutesByDay.stream().allMatch(v -> v == null)) {
            return OptionalDouble.empty();
        }
        double minutes = 0;
        for (int i = 0; i < DAYS; i++) {
            Integer slept = sleepMinutesByDay.get(i);
            if (slept != null) {
                minutes += (i + 1) / 4.0 * Math.max(0, goalMin - slept);
            }
        }
        return OptionalDouble.of(minutes / 60);
    }
}
