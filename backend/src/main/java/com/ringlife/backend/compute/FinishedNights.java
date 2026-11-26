package com.ringlife.backend.compute;

import java.time.LocalDate;

import org.springframework.stereotype.Component;

/**
 * Whether the night of a day is over (ADR 0045, with ADR 0034). The ring also gives the night in progress, so a reading
 * at 03:00 stores a sleep session that ends at 03:00 with nothing after it; after waking up the ring keeps recording.
 * The night of day D is therefore finished only when the device has samples at least {@value #FINISHED_AFTER_MINUTES}
 * minutes after the end of D's sleep session (the longest one ending on D, as in the daily computation). A day
 * without a sleep session has no finished night.
 */
@Component
public class FinishedNights {

    /** Minutes of later samples that prove the night of a day is over. */
    public static final int FINISHED_AFTER_MINUTES = 30;

    private final DailyRepository repository;
    private final ComputeSettings settings;

    FinishedNights(DailyRepository repository, ComputeSettings settings) {
        this.repository = repository;
        this.settings = settings;
    }

    public boolean isFinished(String deviceId, LocalDate day) {
        long from = day.atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(settings.zone()).toInstant().toEpochMilli();
        DailyRepository.SessionRow night = repository.longestSessionEnding(deviceId, from, to);
        return night != null && repository.hasSampleFrom(deviceId, night.endMs() + FINISHED_AFTER_MINUTES * 60_000L);
    }
}
