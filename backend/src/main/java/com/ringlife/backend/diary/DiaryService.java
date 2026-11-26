package com.ringlife.backend.diary;

import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ringlife.backend.diary.DiaryDtos.Counts;
import com.ringlife.backend.diary.DiaryDtos.DiaryRequest;
import com.ringlife.backend.diary.DiaryDtos.DiaryResult;
import com.ringlife.backend.diary.DiaryDtos.Details;
import com.ringlife.backend.diary.DiaryDtos.DiaryView;
import com.ringlife.backend.diary.DiaryDtos.Entry;
import com.ringlife.backend.diary.DiaryDtos.Episode;
import com.ringlife.backend.diary.DiaryDtos.IntensityPoint;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Scrive il diario con upsert per identificativo (ADR 0010). Una richiesta e' una sola transazione: SQLite ha un
 * solo scrittore alla volta e il telefono non vede mai un'applicazione a meta'.
 */
@Service
public class DiaryService {

    private static final String UPSERT_ENTRY =
            "INSERT INTO journal_entry (device_id, id, ts, kind, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
                    + "ON CONFLICT (device_id, id) DO UPDATE SET "
                    + "ts = excluded.ts, kind = excluded.kind, payload = excluded.payload, updated_at = excluded.updated_at";
    private static final String UPSERT_EPISODE =
            "INSERT INTO headache_episode (device_id, id, start_ts, end_ts, intensity, payload, updated_at) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?) "
                    + "ON CONFLICT (device_id, id) DO UPDATE SET start_ts = excluded.start_ts, end_ts = excluded.end_ts, "
                    + "intensity = excluded.intensity, payload = excluded.payload, updated_at = excluded.updated_at";

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final ObjectMapper json;

    public DiaryService(JdbcTemplate jdbc, Clock clock, ObjectMapper json) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.json = json;
    }

    @Transactional
    DiaryResult apply(String deviceId, DiaryRequest request) {
        long now = clock.millis();
        List<Entry> entries = request.entries() == null ? List.of() : request.entries();
        List<Episode> episodes = request.episodes() == null ? List.of() : request.episodes();

        for (Entry entry : entries) {
            jdbc.update(UPSERT_ENTRY, deviceId, entry.id(), entry.ts(), entry.kind(), entryPayload(entry), now);
        }
        for (Episode episode : episodes) {
            jdbc.update(
                    UPSERT_EPISODE, deviceId, episode.id(), episode.start(), episode.end(), episode.intensity(),
                    episodePayload(episode), now);
        }
        int deletedEntries = delete("journal_entry", deviceId, request.deletedEntries());
        int deletedEpisodes = delete("headache_episode", deviceId, request.deletedEpisodes());
        return new DiaryResult(new Counts(entries.size(), deletedEntries), new Counts(episodes.size(), deletedEpisodes));
    }

    /** Il diario salvato per un dispositivo, dal piu' vecchio al piu' recente. Serve a ripristinarlo su un telefono nuovo. */
    @Transactional(readOnly = true)
    DiaryView read(String deviceId) {
        List<Entry> entries = jdbc.query(
                "SELECT id, ts, kind, payload FROM journal_entry WHERE device_id = ? ORDER BY ts, id",
                (rs, i) -> {
                    JsonNode payload = json.readTree(rs.getString(4));
                    return new Entry(
                            rs.getString(1), rs.getLong(2), rs.getString(3),
                            text(payload, "drink"), text(payload, "text"));
                },
                deviceId);
        List<Episode> episodes = jdbc.query(
                "SELECT id, start_ts, end_ts, intensity, payload FROM headache_episode WHERE device_id = ? ORDER BY start_ts, id",
                (rs, i) -> {
                    JsonNode payload = json.readTree(rs.getString(5));
                    long start = rs.getLong(2);
                    long endValue = rs.getLong(3);
                    // `wasNull` vale per l'ultima colonna letta: va chiesto subito dopo la fine.
                    Long end = rs.wasNull() ? null : endValue;
                    return new Episode(
                            rs.getString(1), start, end, rs.getInt(4),
                            json.convertValue(payload.get("intensityLog"), new TypeReference<List<IntensityPoint>>() {}),
                            json.convertValue(payload.get("medicationAt"), new TypeReference<List<Long>>() {}),
                            payload.get("details").isNull() ? null : json.treeToValue(payload.get("details"), Details.class),
                            payload.get("completedAt").isNull() ? null : payload.get("completedAt").asLong());
                },
                deviceId);
        return new DiaryView(entries, episodes);
    }

    private static String text(JsonNode payload, String field) {
        JsonNode node = payload.get(field);
        return node == null || node.isNull() ? null : node.asText();
    }

    private int delete(String table, String deviceId, List<String> ids) {
        int deleted = 0;
        for (String id : ids == null ? List.<String>of() : ids) {
            deleted += jdbc.update("DELETE FROM " + table + " WHERE device_id = ? AND id = ?", deviceId, id);
        }
        return deleted;
    }

    private String entryPayload(Entry entry) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if ("note".equals(entry.kind())) {
            payload.put("text", entry.text());
        } else {
            payload.put("drink", entry.drink());
        }
        return json.writeValueAsString(payload);
    }

    private String episodePayload(Episode episode) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("intensityLog", episode.intensityLog() == null ? List.of() : episode.intensityLog());
        payload.put("medicationAt", episode.medicationAt() == null ? List.of() : episode.medicationAt());
        payload.put("details", episode.details());
        payload.put("completedAt", episode.completedAt());
        return json.writeValueAsString(payload);
    }
}
