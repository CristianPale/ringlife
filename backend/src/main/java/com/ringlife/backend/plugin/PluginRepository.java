package com.ringlife.backend.plugin;

import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Accesso a `plugin_state` e `plugin_result` (ADR 0013). */
@Repository
class PluginRepository {

    record State(boolean enabled, String config) {}

    private final JdbcTemplate jdbc;

    PluginRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Optional<State> state(String deviceId, String pluginId) {
        List<State> rows = jdbc.query(
                "SELECT enabled, config FROM plugin_state WHERE device_id = ? AND plugin_id = ?",
                (rs, i) -> new State(rs.getInt(1) == 1, rs.getString(2)),
                deviceId, pluginId);
        return rows.stream().findFirst();
    }

    void saveState(String deviceId, String pluginId, boolean enabled, String config, long now) {
        jdbc.update(
                "INSERT INTO plugin_state (device_id, plugin_id, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?) "
                        + "ON CONFLICT (device_id, plugin_id) DO UPDATE SET enabled = excluded.enabled, "
                        + "config = excluded.config, updated_at = excluded.updated_at",
                deviceId, pluginId, enabled ? 1 : 0, config, now);
    }

    void saveResult(String deviceId, String pluginId, String day, String version, String payload, long now) {
        jdbc.update(
                "INSERT INTO plugin_result (device_id, plugin_id, day, version, payload, computed_at) VALUES (?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT (device_id, plugin_id, day, version) DO UPDATE SET payload = excluded.payload, "
                        + "computed_at = excluded.computed_at",
                deviceId, pluginId, day, version, payload, now);
    }

    /** Il risultato salvato di un giorno nella versione indicata. */
    Optional<String> result(String deviceId, String pluginId, String day, String version) {
        List<String> rows = jdbc.query(
                "SELECT payload FROM plugin_result WHERE device_id = ? AND plugin_id = ? AND day = ? AND version = ?",
                (rs, i) -> rs.getString(1),
                deviceId, pluginId, day, version);
        return rows.stream().findFirst();
    }

    /** Tutti i dispositivi: per il job notturno. */
    List<String> deviceIds() {
        return jdbc.queryForList("SELECT id FROM device ORDER BY id", String.class);
    }
}
