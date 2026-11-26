package com.ringlife.backend.diary;

import java.util.List;

/** Corpi del sync del diario (ADR 0010). Timestamp in millisecondi dall'epoca, UTC. */
public final class DiaryDtos {

    private DiaryDtos() {}

    /** Una voce di caffeina, alcol o nota. `drink` per le bevande, `text` per le note. */
    record Entry(String id, long ts, String kind, String drink, String text) {}

    record IntensityPoint(long at, int value) {}

    record Details(List<String> symptoms, String location, String medicationHelp, List<String> causes, String notes) {}

    record Episode(
            String id,
            long start,
            Long end,
            int intensity,
            List<IntensityPoint> intensityLog,
            List<Long> medicationAt,
            Details details,
            Long completedAt) {}

    record DiaryRequest(
            List<Entry> entries, List<Episode> episodes, List<String> deletedEntries, List<String> deletedEpisodes) {}

    /** Il diario com'e' sul server: stessa forma della richiesta di invio. */
    public record DiaryView(List<Entry> entries, List<Episode> episodes) {}

    /** Quanti elementi scritti e quanti cancellati davvero. */
    public record Counts(int upserted, int deleted) {}

    public record DiaryResult(Counts entries, Counts episodes) {}
}
