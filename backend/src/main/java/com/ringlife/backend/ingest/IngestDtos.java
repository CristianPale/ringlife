package com.ringlife.backend.ingest;

import java.util.List;

/** Corpi delle richieste e risposte di ingest. Timestamp in millisecondi dall'epoca, UTC. */
public final class IngestDtos {

    private IngestDtos() {}

    record Sample(String metric, long ts, double value) {}

    record SamplesRequest(Integer tzOffsetMin, List<Sample> samples) {}

    record Stage(long start, long end, String stage) {}

    record Session(long start, long end, List<Stage> stages) {}

    record SleepRequest(Integer tzOffsetMin, List<Session> sessions) {}

    /** `received` = quanti elementi nella richiesta, `inserted` = nuovi, `duplicates` = gia' presenti. */
    public record Result(int received, int inserted, int duplicates) {
        static Result of(int received, int inserted) {
            return new Result(received, inserted, received - inserted);
        }
    }
}
