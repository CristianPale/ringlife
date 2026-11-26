package com.ringlife.backend.weather;

import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Accesso a `uv_sample` (ADR 0031). */
@Repository
class UvRepository {

    private final JdbcTemplate jdbc;

    UvRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    void save(long tsMs, double index) {
        jdbc.update(
                "INSERT INTO uv_sample (ts, uv_index) VALUES (?, ?) ON CONFLICT (ts) DO UPDATE SET uv_index = excluded.uv_index",
                tsMs, index);
    }

    List<UvReading> between(long fromMs, long toMs) {
        return jdbc.query(
                "SELECT ts, uv_index FROM uv_sample WHERE ts >= ? AND ts < ? ORDER BY ts",
                (rs, i) -> new UvReading(Instant.ofEpochMilli(rs.getLong(1)), rs.getDouble(2)),
                fromMs, toMs);
    }

    int deleteBefore(long tsMs) {
        return jdbc.update("DELETE FROM uv_sample WHERE ts < ?", tsMs);
    }
}
