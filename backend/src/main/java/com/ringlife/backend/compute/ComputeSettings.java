package com.ringlife.backend.compute;

import java.time.ZoneId;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Parametri del calcolo giornaliero (ADR 0009). Obiettivi e soglie sono configurazione finche' l'app non li sincronizza. */
@Component
public class ComputeSettings {

    private final ZoneId zone;
    private final int sleepGoalMinutes;
    private final int stepsGoal;
    private final int hrZoneThreshold;
    private final int hrSampleMinutes;

    @Autowired
    ComputeSettings(
            @Value("${ringlife.zone:Europe/Rome}") String zone,
            @Value("${ringlife.goals.sleep-minutes:480}") int sleepGoalMinutes,
            @Value("${ringlife.goals.steps:8000}") int stepsGoal,
            @Value("${ringlife.compute.hr-zone-threshold:100}") int hrZoneThreshold,
            @Value("${ringlife.compute.hr-sample-minutes:5}") int hrSampleMinutes) {
        this(ZoneId.of(zone), sleepGoalMinutes, stepsGoal, hrZoneThreshold, hrSampleMinutes);
    }

    public ComputeSettings(ZoneId zone, int sleepGoalMinutes, int stepsGoal, int hrZoneThreshold, int hrSampleMinutes) {
        this.zone = zone;
        this.sleepGoalMinutes = sleepGoalMinutes;
        this.stepsGoal = stepsGoal;
        this.hrZoneThreshold = hrZoneThreshold;
        this.hrSampleMinutes = hrSampleMinutes;
    }

    public ZoneId zone() {
        return zone;
    }

    public int sleepGoalMinutes() {
        return sleepGoalMinutes;
    }

    public int stepsGoal() {
        return stepsGoal;
    }

    /** Battito da cui un campione conta come sforzo moderato o alto. */
    public int hrZoneThreshold() {
        return hrZoneThreshold;
    }

    /** Minuti che rappresenta ogni campione di battito. */
    public int hrSampleMinutes() {
        return hrSampleMinutes;
    }
}
