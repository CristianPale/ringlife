package com.ringlife.backend.diary;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** {@link DiaryLog} sulle tabelle del diario (ADR 0010). */
@Component
class JdbcDiaryLog implements DiaryLog {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    JdbcDiaryLog(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public List<Drink> drinks(String deviceId, long fromMs, long toMs) {
        return jdbc.query(
                "SELECT ts, kind FROM journal_entry WHERE device_id = ? AND kind IN ('caffeine', 'alcohol') "
                        + "AND ts >= ? AND ts < ? ORDER BY ts",
                (rs, i) -> new Drink(rs.getLong(1), rs.getString(2)),
                deviceId, fromMs, toMs);
    }

    @Override
    public List<Headache> headaches(String deviceId, long fromMs, long toMs) {
        return jdbc.query(
                "SELECT start_ts, end_ts, intensity, payload FROM headache_episode "
                        + "WHERE device_id = ? AND start_ts >= ? AND start_ts < ? ORDER BY start_ts",
                (rs, i) -> {
                    long start = rs.getLong(1);
                    long endValue = rs.getLong(2);
                    // `wasNull` vale per l'ultima colonna letta: va chiesto subito dopo.
                    Long end = rs.wasNull() ? null : endValue;
                    int intensity = rs.getInt(3);
                    JsonNode payload = json.readTree(rs.getString(4));
                    int peak = intensity;
                    for (JsonNode point : payload.path("intensityLog")) {
                        peak = Math.max(peak, point.path("value").asInt(0));
                    }
                    return new Headache(start, end, intensity, peak, payload.path("medicationAt").size());
                },
                deviceId, fromMs, toMs);
    }

    @Override
    public List<HeadacheDetails> headacheDetails(String deviceId, long fromMs, long toMs) {
        return jdbc.query(
                "SELECT start_ts, payload FROM headache_episode "
                        + "WHERE device_id = ? AND start_ts >= ? AND start_ts < ? ORDER BY start_ts",
                (rs, i) -> {
                    JsonNode details = json.readTree(rs.getString(2)).path("details");
                    String location = details.path("location").isString() ? details.path("location").asString() : null;
                    String help = details.path("medicationHelp").isString() ? details.path("medicationHelp").asString() : null;
                    return new HeadacheDetails(rs.getLong(1), strings(details.path("symptoms")), location, help, strings(details.path("causes")));
                },
                deviceId, fromMs, toMs);
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new java.util.ArrayList<>();
        for (JsonNode item : array) {
            if (item.isString()) {
                out.add(item.asString());
            }
        }
        return out;
    }

    @Override
    public boolean hasDrinkEntriesSince(String deviceId, long fromMs) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM journal_entry WHERE device_id = ? AND kind IN ('caffeine', 'alcohol') AND ts >= ?",
                Integer.class, deviceId, fromMs);
        return count != null && count > 0;
    }
}
