package com.ringlife.backend.push;

import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/** Access to `push_registration` (ADR 0047). Portable SQL: SQLite now, PostgreSQL later. */
@Repository
public class PushRegistrations {

    private static final RowMapper<PushRegistration> ROW = (rs, i) -> new PushRegistration(
            rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getLong(6),
            rs.getObject(7) == null ? null : rs.getLong(7), rs.getString(8));

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;

    PushRegistrations(JdbcTemplate jdbc, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.transaction = transaction;
    }

    public Optional<PushRegistration> find(String deviceId) {
        return jdbc.query(
                        "SELECT device_id, token, key, environment, created_at, updated_at, last_sent_at, last_error "
                                + "FROM push_registration WHERE device_id = ?",
                        ROW, deviceId)
                .stream()
                .findFirst();
    }

    public boolean exists(String deviceId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM push_registration WHERE device_id = ?", Integer.class, deviceId);
        return count != null && count > 0;
    }

    /** A new registration, or a new token, key or environment for the same device: the last error goes away. */
    void save(String deviceId, String token, String key, String environment, long now) {
        jdbc.update(
                "INSERT INTO push_registration (device_id, token, key, environment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT (device_id) DO UPDATE SET token = excluded.token, key = excluded.key, "
                        + "environment = excluded.environment, updated_at = excluded.updated_at, last_error = NULL",
                deviceId, token, key, environment, now, now);
    }

    /**
     * Removes the registration. The events still waiting for a push go back to `none`, so the phone notifies them
     * itself the next time the app runs (phase 1). `true` if there was one.
     */
    public boolean delete(String deviceId) {
        Boolean deleted = transaction.execute(status -> {
            jdbc.update("UPDATE alert_event SET push_state = 'none', push_due_at = NULL WHERE device_id = ? AND push_state = 'pending'",
                    deviceId);
            return jdbc.update("DELETE FROM push_registration WHERE device_id = ?", deviceId) > 0;
        });
        return Boolean.TRUE.equals(deleted);
    }

    public void markSent(String deviceId, long now) {
        jdbc.update("UPDATE push_registration SET last_sent_at = ?, last_error = NULL WHERE device_id = ?", now, deviceId);
    }

    /** `error` is Apple's reason or a short description: never a token, a key or a health value. */
    public void markError(String deviceId, String error) {
        jdbc.update("UPDATE push_registration SET last_error = ? WHERE device_id = ?", error, deviceId);
    }
}
