package com.ringlife.backend.weather;

import java.util.List;
import java.util.OptionalDouble;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Accesso a `weather_sample` (ADR 0017). */
@Repository
class PressureRepository {

    private final JdbcTemplate jdbc;

    PressureRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    void save(long tsMs, double hpa) {
        jdbc.update(
                "INSERT INTO weather_sample (ts, pressure_hpa) VALUES (?, ?) "
                        + "ON CONFLICT (ts) DO UPDATE SET pressure_hpa = excluded.pressure_hpa",
                tsMs, hpa);
    }

    /** La lettura piu' vicina a `targetMs` entro `toleranceMs`, se c'e'. */
    OptionalDouble nearest(long targetMs, long toleranceMs) {
        List<Double> rows = jdbc.query(
                "SELECT pressure_hpa FROM weather_sample WHERE ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1",
                (rs, i) -> rs.getDouble(1),
                targetMs - toleranceMs, targetMs + toleranceMs, targetMs);
        return rows.isEmpty() ? OptionalDouble.empty() : OptionalDouble.of(rows.get(0));
    }

    int deleteBefore(long tsMs) {
        return jdbc.update("DELETE FROM weather_sample WHERE ts < ?", tsMs);
    }
}
