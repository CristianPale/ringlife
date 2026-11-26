package com.ringlife.backend.score;

import java.util.List;

/** Una notte di sonno, gia' ridotta ai minuti per fase. Le fasi le calcola l'anello. */
public record SleepNight(int deepMin, int lightMin, int remMin, int awakeMin, int awakenings) {

    public int asleepMin() {
        return deepMin + lightMin + remMin;
    }

    public int inBedMin() {
        return asleepMin() + awakeMin;
    }

    /** Quota del tempo a letto passata dormendo, 0-1. */
    public double efficiency() {
        return inBedMin() == 0 ? 0 : (double) asleepMin() / inBedMin();
    }

    public record Stage(String stage, long startMs, long endMs) {}

    /** Riassume le fasi di una sessione. I risvegli sono i tratti `awake` dopo il primo addormentamento. */
    public static SleepNight fromStages(List<Stage> stages) {
        int deep = 0;
        int light = 0;
        int rem = 0;
        int awake = 0;
        int awakenings = 0;
        boolean asleep = false;
        for (Stage s : stages.stream().sorted((a, b) -> Long.compare(a.startMs(), b.startMs())).toList()) {
            int minutes = (int) Math.round((s.endMs() - s.startMs()) / 60_000.0);
            switch (s.stage()) {
                case "deep" -> {
                    deep += minutes;
                    asleep = true;
                }
                case "light" -> {
                    light += minutes;
                    asleep = true;
                }
                case "rem" -> {
                    rem += minutes;
                    asleep = true;
                }
                case "awake" -> {
                    awake += minutes;
                    if (asleep) {
                        awakenings++;
                    }
                }
                default -> throw new IllegalArgumentException("Fase sconosciuta");
            }
        }
        return new SleepNight(deep, light, rem, awake, awakenings);
    }
}
