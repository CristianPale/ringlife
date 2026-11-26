package com.ringlife.backend.ingest;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ringlife.backend.ingest.IngestDtos.Result;
import com.ringlife.backend.ingest.IngestDtos.Sample;
import com.ringlife.backend.ingest.IngestDtos.Session;
import com.ringlife.backend.ingest.IngestDtos.Stage;

/**
 * Scrive i dati grezzi in modo idempotente (ADR 0008). Ogni inserimento usa `ON CONFLICT DO NOTHING`:
 * con SQLite Spring non traduce gli errori di vincolo, quindi l'idempotenza non puo' basarsi su un'eccezione.
 * Una richiesta e' una sola transazione, breve: SQLite ha un solo scrittore alla volta.
 */
@Service
public class IngestService {

    private static final String INSERT_SAMPLE =
            "INSERT INTO sample (device_id, metric, ts, value) VALUES (?, ?, ?, ?) "
                    + "ON CONFLICT (device_id, metric, ts) DO NOTHING";
    private static final String INSERT_SESSION =
            "INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?) "
                    + "ON CONFLICT (device_id, start_ts) DO NOTHING";
    private static final String INSERT_STAGE =
            "INSERT INTO sleep_stage (session_id, start_ts, end_ts, stage) VALUES (?, ?, ?, ?) "
                    + "ON CONFLICT (session_id, start_ts) DO NOTHING";
    private static final String FIND_SESSION =
            "SELECT id, end_ts FROM sleep_session WHERE device_id = ? AND start_ts = ?";

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public IngestService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional
    public Result ingestSamples(String deviceId, int tzOffsetMin, List<Sample> samples) {
        int inserted = 0;
        for (Sample sample : samples) {
            inserted += jdbc.update(INSERT_SAMPLE, deviceId, sample.metric(), sample.ts(), sample.value());
        }
        recordSync(deviceId, "samples", tzOffsetMin, samples.size(), inserted);
        touchDevice(deviceId);
        return Result.of(samples.size(), inserted);
    }

    /**
     * Una notte nuova si scrive con le sue fasi. Una notte gia' presente (stesso inizio) si riscrive solo se arriva piu'
     * lunga: l'anello da' anche la notte in corso, quindi una lettura fatta alle 3 di notte manda una sessione che finisce
     * alle 3, e quella del mattino la stessa sessione con la fine vera (ADR 0034). Una versione piu' corta, per esempio una
     * lettura vecchia rimasta in coda sul telefono, non tocca quella piu' lunga. Le notti allungate contano tra le nuove.
     */
    @Transactional
    public Result ingestSleep(String deviceId, int tzOffsetMin, List<Session> sessions) {
        int inserted = 0;
        for (Session session : sessions) {
            List<StoredSession> existing = jdbc.query(
                    FIND_SESSION, (rs, i) -> new StoredSession(rs.getString(1), rs.getLong(2)), deviceId, session.start());
            if (existing.isEmpty()) {
                String sessionId = UUID.randomUUID().toString();
                int added = jdbc.update(INSERT_SESSION, sessionId, deviceId, session.start(), session.end());
                if (added == 1) {
                    insertStages(sessionId, session);
                }
                inserted += added;
            } else if (session.end() > existing.get(0).endTs()) {
                String sessionId = existing.get(0).id();
                jdbc.update("UPDATE sleep_session SET end_ts = ? WHERE id = ?", session.end(), sessionId);
                jdbc.update("DELETE FROM sleep_stage WHERE session_id = ?", sessionId);
                insertStages(sessionId, session);
                inserted++;
            }
        }
        recordSync(deviceId, "sleep", tzOffsetMin, sessions.size(), inserted);
        touchDevice(deviceId);
        return Result.of(sessions.size(), inserted);
    }

    private void insertStages(String sessionId, Session session) {
        if (session.stages() == null) {
            return;
        }
        for (Stage stage : session.stages()) {
            jdbc.update(INSERT_STAGE, sessionId, stage.start(), stage.end(), stage.stage());
        }
    }

    private record StoredSession(String id, long endTs) {}

    private void recordSync(String deviceId, String kind, int tzOffsetMin, int received, int inserted) {
        jdbc.update(
                "INSERT INTO sync_log (id, device_id, kind, received_at, tz_offset_min, received_count, inserted_count) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(), deviceId, kind, clock.millis(), tzOffsetMin, received, inserted);
    }

    private void touchDevice(String deviceId) {
        jdbc.update("UPDATE device SET last_sync_at = ? WHERE id = ?", clock.millis(), deviceId);
    }
}
