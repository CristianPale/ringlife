package com.ringlife.backend.alert;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.ringlife.backend.alert.AlertCatalog.Settings;

/**
 * Access to `alert_settings`, `alert_rule`, `alert_custom_rule` and `alert_event` (ADR 0045, 0046, 0047). Portable SQL:
 * SQLite now, PostgreSQL later.
 */
@Repository
class AlertRepository {

    /** A stored rule: on or off and the parameters chosen by the user (JSON), the rest are the rule's defaults. */
    record RuleRow(boolean enabled, String config) {}

    record EventRow(
            String id,
            String rule,
            String day,
            String level,
            String title,
            String body,
            String route,
            String valuesJson,
            long createdAt,
            Long deliverAfter,
            Long seenAt,
            String pushState,
            Long pushDueAt) {}

    /** An event waiting for its push (ADR 0047): what the push says and when the event was created. */
    record PendingPush(
            String id,
            String deviceId,
            String rule,
            String day,
            String title,
            String body,
            String route,
            String valuesJson,
            long createdAt) {}

    static final String PUSH_NONE = "none";
    static final String PUSH_PENDING = "pending";
    static final String PUSH_SENT = "sent";
    static final String PUSH_FAILED = "failed";

    private static final String EVENT_COLUMNS =
            "id, rule_id, day, level, title, body, route, values_json, created_at, deliver_after, seen_at, push_state, push_due_at";

    private static final RowMapper<EventRow> EVENT = (rs, i) -> new EventRow(
            rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
            rs.getString(7), rs.getString(8), rs.getLong(9),
            rs.getObject(10) == null ? null : rs.getLong(10),
            rs.getObject(11) == null ? null : rs.getLong(11),
            rs.getString(12),
            rs.getObject(13) == null ? null : rs.getLong(13));

    private static final String CUSTOM_COLUMNS = "id, metric, comparison, amount, days, level, delivery, enabled";

    private static final RowMapper<CustomCatalog.Rule> CUSTOM = (rs, i) -> new CustomCatalog.Rule(
            rs.getString(1), rs.getString(2), rs.getString(3), rs.getDouble(4), rs.getInt(5), rs.getString(6), rs.getString(7),
            rs.getInt(8) == 1);

    private final JdbcTemplate jdbc;

    AlertRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Optional<Settings> settings(String deviceId) {
        return jdbc.query(
                        "SELECT quiet_start, quiet_end, lock_screen, home_assistant FROM alert_settings WHERE device_id = ?",
                        (rs, i) -> new Settings(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4) == 1),
                        deviceId)
                .stream()
                .findFirst();
    }

    void saveSettings(String deviceId, Settings settings, long now) {
        jdbc.update(
                "INSERT INTO alert_settings (device_id, quiet_start, quiet_end, lock_screen, home_assistant, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (device_id) DO UPDATE SET quiet_start = excluded.quiet_start, "
                        + "quiet_end = excluded.quiet_end, lock_screen = excluded.lock_screen, "
                        + "home_assistant = excluded.home_assistant, updated_at = excluded.updated_at",
                deviceId, settings.quietStart(), settings.quietEnd(), settings.lockScreen(), settings.homeAssistant() ? 1 : 0, now);
    }

    /** The stored rules of a device, by rule id. A rule without a row uses its defaults. */
    Map<String, RuleRow> rules(String deviceId) {
        Map<String, RuleRow> rules = new LinkedHashMap<>();
        jdbc.query(
                "SELECT rule_id, enabled, config FROM alert_rule WHERE device_id = ?",
                rs -> {
                    rules.put(rs.getString(1), new RuleRow(rs.getInt(2) == 1, rs.getString(3)));
                },
                deviceId);
        return rules;
    }

    void saveRule(String deviceId, String ruleId, boolean enabled, String config, long now) {
        jdbc.update(
                "INSERT INTO alert_rule (device_id, rule_id, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?) "
                        + "ON CONFLICT (device_id, rule_id) DO UPDATE SET enabled = excluded.enabled, config = excluded.config, "
                        + "updated_at = excluded.updated_at",
                deviceId, ruleId, enabled ? 1 : 0, config, now);
    }

    /** Writes the event unless the device already has one for that rule and day. `true` if it was written. */
    boolean insertIfAbsent(String deviceId, EventRow event) {
        return jdbc.update(
                        "INSERT INTO alert_event (" + EVENT_COLUMNS + ", device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                                + "ON CONFLICT (device_id, rule_id, day) DO NOTHING",
                        event.id(), event.rule(), event.day(), event.level(), event.title(), event.body(), event.route(),
                        event.valuesJson(), event.createdAt(), event.deliverAfter(), event.seenAt(), event.pushState(),
                        event.pushDueAt(), deviceId)
                > 0;
    }

    // --- your own rules (ADR 0046) ---

    /** The rules of a device, oldest first. */
    List<CustomCatalog.Rule> customRules(String deviceId) {
        return jdbc.query(
                "SELECT " + CUSTOM_COLUMNS + " FROM alert_custom_rule WHERE device_id = ? ORDER BY created_at, id", CUSTOM, deviceId);
    }

    Optional<CustomCatalog.Rule> customRule(String deviceId, String ruleId) {
        return jdbc.query("SELECT " + CUSTOM_COLUMNS + " FROM alert_custom_rule WHERE device_id = ? AND id = ?", CUSTOM, deviceId, ruleId)
                .stream()
                .findFirst();
    }

    /** The latest creation time among the rules of the device, 0 without rules. */
    long lastCustomCreatedAt(String deviceId) {
        Long last = jdbc.queryForObject("SELECT MAX(created_at) FROM alert_custom_rule WHERE device_id = ?", Long.class, deviceId);
        return last == null ? 0 : last;
    }

    int countCustomRules(String deviceId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM alert_custom_rule WHERE device_id = ?", Integer.class, deviceId);
        return count == null ? 0 : count;
    }

    void insertCustomRule(String deviceId, CustomCatalog.Rule rule, long now) {
        jdbc.update(
                "INSERT INTO alert_custom_rule (device_id, " + CUSTOM_COLUMNS + ", created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                deviceId, rule.id(), rule.metric(), rule.comparison(), rule.amount(), rule.days(), rule.level(), rule.delivery(),
                rule.enabled() ? 1 : 0, now, now);
    }

    void updateCustomRule(String deviceId, CustomCatalog.Rule rule, long now) {
        jdbc.update(
                "UPDATE alert_custom_rule SET metric = ?, comparison = ?, amount = ?, days = ?, level = ?, delivery = ?, enabled = ?, "
                        + "updated_at = ? WHERE device_id = ? AND id = ?",
                rule.metric(), rule.comparison(), rule.amount(), rule.days(), rule.level(), rule.delivery(), rule.enabled() ? 1 : 0,
                now, deviceId, rule.id());
    }

    /** Removes the rule; its events stay. `true` if it existed. */
    boolean deleteCustomRule(String deviceId, String ruleId) {
        return jdbc.update("DELETE FROM alert_custom_rule WHERE device_id = ? AND id = ?", deviceId, ruleId) > 0;
    }

    // --- pushes (ADR 0047) ---

    /** Events of every device whose push is due at `now`, grouped by device, the oldest day first. */
    List<PendingPush> duePushes(long now) {
        return jdbc.query(
                "SELECT id, device_id, rule_id, day, title, body, route, values_json, created_at FROM alert_event "
                        + "WHERE push_state = 'pending' AND push_due_at <= ? ORDER BY device_id, day, created_at, rule_id",
                (rs, i) -> new PendingPush(
                        rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                        rs.getString(7), rs.getString(8), rs.getLong(9)),
                now);
    }

    /** Sets the push state of the given events; `pushedAt` only for `sent`. */
    void setPushState(List<String> ids, String state, Long pushedAt) {
        if (ids.isEmpty()) {
            return;
        }
        Object[] args = new Object[ids.size() + 2];
        args[0] = state;
        args[1] = pushedAt;
        for (int i = 0; i < ids.size(); i++) {
            args[i + 2] = ids.get(i);
        }
        jdbc.update("UPDATE alert_event SET push_state = ?, pushed_at = ? WHERE id IN (" + marks(ids.size()) + ")", args);
    }

    /** One more failed attempt: the events stay pending until `maxAttempts`, then they are `failed`. */
    void pushAttemptFailed(List<String> ids, int maxAttempts) {
        if (ids.isEmpty()) {
            return;
        }
        Object[] args = new Object[ids.size() + 1];
        args[0] = maxAttempts;
        for (int i = 0; i < ids.size(); i++) {
            args[i + 1] = ids.get(i);
        }
        jdbc.update(
                "UPDATE alert_event SET push_attempts = push_attempts + 1, "
                        + "push_state = CASE WHEN push_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END "
                        + "WHERE push_state = 'pending' AND id IN (" + marks(ids.size()) + ")",
                args);
    }

    /** Pending pushes of a device (or of every device with null) go back to `none`: the phone notifies them itself. */
    int clearPendingPushes(String deviceId) {
        return deviceId == null
                ? jdbc.update("UPDATE alert_event SET push_state = 'none', push_due_at = NULL WHERE push_state = 'pending'")
                : jdbc.update("UPDATE alert_event SET push_state = 'none', push_due_at = NULL WHERE push_state = 'pending' "
                        + "AND device_id = ?", deviceId);
    }

    private static String marks(int count) {
        return String.join(", ", Collections.nCopies(count, "?"));
    }

    /** The events created at or after `sinceMs`, the most recent day first, at most `limit`. */
    List<EventRow> events(String deviceId, long sinceMs, int limit) {
        return jdbc.query(
                "SELECT " + EVENT_COLUMNS + " FROM alert_event WHERE device_id = ? AND created_at >= ? "
                        + "ORDER BY day DESC, created_at DESC, rule_id LIMIT ?",
                EVENT, deviceId, sinceMs, limit);
    }

    /** The most recent event (latest day, then latest created), if any. */
    Optional<EventRow> latest(String deviceId) {
        return jdbc.query(
                        "SELECT " + EVENT_COLUMNS + " FROM alert_event WHERE device_id = ? "
                                + "ORDER BY day DESC, created_at DESC, rule_id LIMIT 1",
                        EVENT, deviceId)
                .stream()
                .findFirst();
    }

    int unseen(String deviceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM alert_event WHERE device_id = ? AND seen_at IS NULL", Integer.class, deviceId);
        return count == null ? 0 : count;
    }

    /** Marks the given events of the device as seen; already seen ones keep their time. Returns how many changed. */
    int markSeen(String deviceId, List<String> ids, long now) {
        if (ids.isEmpty()) {
            return 0;
        }
        String marks = marks(ids.size());
        Object[] args = new Object[ids.size() + 2];
        args[0] = now;
        args[1] = deviceId;
        for (int i = 0; i < ids.size(); i++) {
            args[i + 2] = ids.get(i);
        }
        return jdbc.update(
                "UPDATE alert_event SET seen_at = ? WHERE device_id = ? AND seen_at IS NULL AND id IN (" + marks + ")", args);
    }

    int markAllSeen(String deviceId, long now) {
        return jdbc.update("UPDATE alert_event SET seen_at = ? WHERE device_id = ? AND seen_at IS NULL", now, deviceId);
    }

    /** Deletes the events of every device up to the given local day, included. */
    int deleteEventsUpTo(java.time.LocalDate lastDay) {
        return jdbc.update("DELETE FROM alert_event WHERE day <= ?", lastDay.toString());
    }

    /** Every device: for the nightly job. */
    List<String> deviceIds() {
        return jdbc.queryForList("SELECT id FROM device ORDER BY id", String.class);
    }
}
