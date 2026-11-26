package com.ringlife.backend.compute;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ringlife.backend.compute.FeatureExtractor.Sample;
import com.ringlife.backend.score.SleepNight.Stage;

/** Accesso ai dati grezzi e alle tabelle giornaliere (ADR 0009). Un solo posto per le query. */
@Repository
class DailyRepository {

    record SessionRow(String id, long startMs, long endMs) {}

    record ScoreRow(String day, String kind, String algoVersion, int value, String components) {}

    record MetricRow(String day, String metric, String algoVersion, Double value, String unit, String detail) {}

    record BaselineRow(double median, double mad, int count) {}

    private final JdbcTemplate jdbc;

    DailyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<String> deviceIds() {
        return jdbc.queryForList("SELECT id FROM device", String.class);
    }

    List<Sample> samples(String deviceId, String metric, long fromMs, long toMsExclusive) {
        return jdbc.query(
                "SELECT ts, value FROM sample WHERE device_id = ? AND metric = ? AND ts >= ? AND ts < ? ORDER BY ts",
                (rs, i) -> new Sample(rs.getLong(1), rs.getDouble(2)),
                deviceId, metric, fromMs, toMsExclusive);
    }

    /** La sessione di sonno piu' lunga che finisce nell'intervallo: le sieste non contano. */
    SessionRow longestSessionEnding(String deviceId, long fromMs, long toMsExclusive) {
        return jdbc.query(
                        "SELECT id, start_ts, end_ts FROM sleep_session WHERE device_id = ? AND end_ts >= ? AND end_ts < ? "
                                + "ORDER BY (end_ts - start_ts) DESC LIMIT 1",
                        (rs, i) -> new SessionRow(rs.getString(1), rs.getLong(2), rs.getLong(3)),
                        deviceId, fromMs, toMsExclusive)
                .stream()
                .findFirst()
                .orElse(null);
    }

    /** Whether the device has at least one sample, of any metric, at or after the instant. */
    boolean hasSampleFrom(String deviceId, long fromMs) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM (SELECT 1 FROM sample WHERE device_id = ? AND ts >= ? LIMIT 1) AS later",
                Integer.class, deviceId, fromMs);
        return count != null && count > 0;
    }

    List<Stage> stages(String sessionId) {
        return jdbc.query(
                "SELECT stage, start_ts, end_ts FROM sleep_stage WHERE session_id = ? ORDER BY start_ts",
                (rs, i) -> new Stage(rs.getString(1), rs.getLong(2), rs.getLong(3)),
                sessionId);
    }

    Map<LocalDate, Double> featureSeries(String deviceId, String feature, LocalDate from, LocalDate to) {
        Map<LocalDate, Double> series = new LinkedHashMap<>();
        jdbc.query(
                "SELECT day, value FROM daily_feature WHERE device_id = ? AND feature = ? AND day >= ? AND day <= ? ORDER BY day",
                rs -> {
                    series.put(LocalDate.parse(rs.getString(1)), rs.getDouble(2));
                },
                deviceId, feature, from.toString(), to.toString());
        return series;
    }

    void replaceFeatures(String deviceId, LocalDate day, Map<String, Double> features) {
        jdbc.update("DELETE FROM daily_feature WHERE device_id = ? AND day = ?", deviceId, day.toString());
        features.forEach((feature, value) -> jdbc.update(
                "INSERT INTO daily_feature (device_id, day, feature, value) VALUES (?, ?, ?, ?)",
                deviceId, day.toString(), feature, value));
    }

    void replaceBaselines(String deviceId, LocalDate day, Map<String, BaselineRow> baselines) {
        jdbc.update("DELETE FROM baseline WHERE device_id = ? AND day = ?", deviceId, day.toString());
        baselines.forEach((feature, row) -> jdbc.update(
                "INSERT INTO baseline (device_id, day, feature, window_days, median, mad, count) VALUES (?, ?, ?, ?, ?, ?, ?)",
                deviceId, day.toString(), feature, 28, row.median(), row.mad(), row.count()));
    }

    /** Riscrive i punteggi della versione indicata per quel giorno. Le altre versioni restano. */
    void replaceScores(String deviceId, LocalDate day, String algoVersion, Map<String, ScoreRow> scores, long now) {
        jdbc.update("DELETE FROM daily_score WHERE device_id = ? AND day = ? AND algo_version = ?", deviceId, day.toString(), algoVersion);
        scores.forEach((kind, row) -> jdbc.update(
                "INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                deviceId, day.toString(), kind, algoVersion, row.value(), row.components(), now));
    }

    void replaceMetrics(String deviceId, LocalDate day, String algoVersion, Map<String, MetricRow> metrics, long now) {
        jdbc.update("DELETE FROM daily_metric WHERE device_id = ? AND day = ? AND algo_version = ?", deviceId, day.toString(), algoVersion);
        metrics.forEach((metric, row) -> jdbc.update(
                "INSERT INTO daily_metric (device_id, day, metric, algo_version, value, unit, detail, computed_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                deviceId, day.toString(), metric, algoVersion, row.value(), row.unit(), row.detail(), now));
    }

    List<ScoreRow> scores(String deviceId, LocalDate from, LocalDate to, String algoVersion) {
        return jdbc.query(
                "SELECT day, kind, algo_version, value, components FROM daily_score "
                        + "WHERE device_id = ? AND day >= ? AND day <= ? AND algo_version = ? ORDER BY day, kind",
                (rs, i) -> new ScoreRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4), rs.getString(5)),
                deviceId, from.toString(), to.toString(), algoVersion);
    }

    List<MetricRow> metrics(String deviceId, LocalDate from, LocalDate to, String algoVersion) {
        return jdbc.query(
                "SELECT day, metric, algo_version, value, unit, detail FROM daily_metric "
                        + "WHERE device_id = ? AND day >= ? AND day <= ? AND algo_version = ? ORDER BY day, metric",
                (rs, i) -> new MetricRow(
                        rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getObject(4) == null ? null : rs.getDouble(4), rs.getString(5), rs.getString(6)),
                deviceId, from.toString(), to.toString(), algoVersion);
    }

    /** Istante dell'ultimo caricamento del dispositivo, null se non ne ha mai fatti. */
    Long lastSyncAt(String deviceId) {
        return jdbc.query("SELECT last_sync_at FROM device WHERE id = ?",
                        (rs, i) -> rs.getObject(1) == null ? null : rs.getLong(1), deviceId)
                .stream().findFirst().orElse(null);
    }

    /** Il dispositivo che ha caricato dati piu' di recente (l'utente e' uno solo), null se nessuno ha mai caricato. */
    String latestSyncedDevice() {
        return jdbc.query("SELECT id FROM device WHERE last_sync_at IS NOT NULL ORDER BY last_sync_at DESC LIMIT 1",
                        (rs, i) -> rs.getString(1))
                .stream().findFirst().orElse(null);
    }

    /** Le baseline dei giorni indicati, per giorno e feature: dicono su quanti giorni si basa la media («calibrazione in corso»). */
    Map<String, Map<String, BaselineRow>> baselineRows(String deviceId, LocalDate from, LocalDate to) {
        Map<String, Map<String, BaselineRow>> byDay = new LinkedHashMap<>();
        jdbc.query(
                "SELECT day, feature, median, mad, count FROM baseline WHERE device_id = ? AND day >= ? AND day <= ? ORDER BY day, feature",
                rs -> {
                    byDay.computeIfAbsent(rs.getString(1), d -> new LinkedHashMap<>())
                            .put(rs.getString(2), new BaselineRow(rs.getDouble(3), rs.getDouble(4), rs.getInt(5)));
                },
                deviceId, from.toString(), to.toString());
        return byDay;
    }

    /** I valori giornalieri estratti (daily_feature) nei giorni indicati, per giorno e feature. */
    Map<String, Map<String, Double>> featureValues(String deviceId, LocalDate from, LocalDate to) {
        Map<String, Map<String, Double>> byDay = new LinkedHashMap<>();
        jdbc.query(
                "SELECT day, feature, value FROM daily_feature WHERE device_id = ? AND day >= ? AND day <= ? ORDER BY day, feature",
                rs -> {
                    byDay.computeIfAbsent(rs.getString(1), d -> new LinkedHashMap<>()).put(rs.getString(2), rs.getDouble(3));
                },
                deviceId, from.toString(), to.toString());
        return byDay;
    }
}
