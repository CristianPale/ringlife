package com.ringlife.backend.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Pulizia dei dati vecchi (ADR 0021). Dati sintetici. */
@SpringBootTest
@AutoConfigureMockMvc
class AdminPurgeTest {

    private static final Path DB_DIR = createTempDir();
    private static final String SECRET = "test-pairing-secret";
    private static final long CUT = Instant.parse("2026-11-15T00:00:00Z").toEpochMilli();
    private static final long HOUR = 3_600_000L;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("admin.sqlite").toString());
        registry.add("ringlife.pairing-secret", () -> SECRET);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void seed() {
        for (String table : new String[] {"sleep_stage", "sleep_session", "sample", "daily_score", "daily_feature", "baseline", "journal_entry", "alert_event"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT OR IGNORE INTO device (id, mac, model, firmware, last_sync_at) VALUES ('d1', 'synthetic', 'synthetic', NULL, NULL)");
        // Due campioni prima del taglio (di prova), due dopo (veri).
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES ('d1', 'HR', ?, 60)", CUT - 2 * HOUR);
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES ('d1', 'STEPS', ?, 100)", CUT - HOUR);
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES ('d1', 'HR', ?, 70)", CUT + 2 * HOUR);
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES ('d1', 'STEPS', ?, 300)", CUT + 3 * HOUR);
        // Una notte vecchia con una fase, una nuova.
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES ('old', 'd1', ?, ?)", CUT - 20 * HOUR, CUT - 12 * HOUR);
        jdbc.update("INSERT INTO sleep_stage (session_id, start_ts, end_ts, stage) VALUES ('old', ?, ?, 'light')", CUT - 20 * HOUR, CUT - 19 * HOUR);
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES ('new', 'd1', ?, ?)", CUT + 20 * HOUR, CUT + 28 * HOUR);
        jdbc.update("INSERT INTO sleep_stage (session_id, start_ts, end_ts, stage) VALUES ('new', ?, ?, 'deep')", CUT + 20 * HOUR, CUT + 21 * HOUR);
        jdbc.update("INSERT INTO daily_feature (device_id, day, feature, value) VALUES ('d1', '2026-11-10', 'steps', 1)");
    }

    private String body() {
        return "{\"before\":" + CUT + "}";
    }

    @Test
    void removesOlderRawDataAndKeepsNewer() throws Exception {
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.samples").value(2))
                .andExpect(jsonPath("$.sleepSessions").value(1));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sample WHERE ts < ?", Integer.class, CUT)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sample", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT id FROM sleep_session", String.class)).containsExactly("new");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sleep_stage WHERE session_id = 'old'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sleep_stage WHERE session_id = 'new'", Integer.class)).isEqualTo(1);
    }

    @Test
    void dropsStaleDerivedValues() throws Exception {
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM daily_feature WHERE day = '2026-11-10'", Integer.class)).isZero();
    }

    @Test
    void dropsTheAlertEventsOfThePurgedDays() throws Exception {
        // The cut is 01:00 in Rome on 15 November: the 14th and the first hour of the 15th are purged, the 16th is not.
        for (String day : new String[] {"2026-11-14", "2026-11-15", "2026-11-16"}) {
            jdbc.update("INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, created_at) "
                    + "VALUES (?, 'd1', 'hrv', ?, 'attenzione', 'Titolo', 'Testo.', '/indici/recupero', 1)", "a-" + day, day);
        }
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alertEvents").value(2));
        assertThat(jdbc.queryForList("SELECT id FROM alert_event WHERE id LIKE 'a-%'", String.class)).containsExactly("a-2026-11-16");
    }

    @Test
    void dropsPendingPushesWithTheirEventsAndKeepsRulesAndRegistrations() throws Exception {
        jdbc.update("DELETE FROM push_registration");
        jdbc.update("DELETE FROM alert_custom_rule");
        jdbc.update("INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, created_at, push_state, push_due_at) "
                + "VALUES ('p-old', 'd1', 'hrv', '2026-11-14', 'attenzione', 'Titolo', 'Testo.', '/indici/recupero', 1, 'pending', 1)");
        jdbc.update("INSERT INTO push_registration (device_id, token, key, environment, created_at, updated_at) "
                + "VALUES ('d1', 'abab', 'synthetic', 'sandbox', 1, 1)");
        jdbc.update("INSERT INTO alert_custom_rule (device_id, id, metric, comparison, amount, days, level, delivery, enabled, created_at, "
                + "updated_at) VALUES ('d1', 'custom-0000beef', 'steps', 'below', 3000, 3, 'attenzione', 'notifica', 1, 1, 1)");
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE id = 'p-old'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_registration WHERE device_id = 'd1'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_custom_rule WHERE device_id = 'd1'", Integer.class)).isEqualTo(1);
    }

    @Test
    void keepsTheDiary() throws Exception {
        jdbc.update("INSERT INTO journal_entry (id, device_id, ts, kind, payload, updated_at) VALUES ('j1', 'd1', ?, 'note', '{}', 1)", CUT - HOUR);
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM journal_entry", Integer.class)).isEqualTo(1);
    }

    @Test
    void needsTheSecretAndABound() throws Exception {
        mvc.perform(post("/api/v1/admin/purge").contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", "wrong").contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/purge").header("X-Pairing-Secret", SECRET).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sample", Integer.class)).isEqualTo(4);
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-admin-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
