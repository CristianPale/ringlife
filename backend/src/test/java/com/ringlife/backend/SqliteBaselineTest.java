package com.ringlife.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class SqliteBaselineTest {

    private static final Path DB_DIR = createTempDir();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("test.sqlite").toString());
    }

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void flywayAppliesBaselineMigration() {
        Integer applied = jdbc.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1", Integer.class);
        assertThat(applied).isEqualTo(11);
    }

    @Test
    void alertEventsAreUniquePerRuleAndDayAndGoWithTheirDevice() {
        jdbc.update("INSERT INTO device (id, mac, model) VALUES ('d3', 'synthetic-3', 'test')");
        String insert = "INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, created_at) "
                + "VALUES (?, 'd3', 'hrv', '2026-11-14', 'attenzione', 't', 'b', '/indici/recupero', 1) "
                + "ON CONFLICT (device_id, rule_id, day) DO NOTHING";
        assertThat(jdbc.update(insert, "e1")).isEqualTo(1);
        assertThat(jdbc.update(insert, "e2")).isZero();
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, created_at) "
                        + "VALUES ('e3', 'd3', 'hrv', '2026-11-15', 'rosso', 't', 'b', '/', 1)"))
                .isInstanceOf(DataAccessException.class);
        jdbc.update("DELETE FROM device WHERE id = 'd3'");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE device_id = 'd3'", Integer.class)).isZero();
    }

    @Test
    void customRulesAndPushRegistrationsHaveTheirChecksAndGoWithTheirDevice() {
        jdbc.update("INSERT INTO device (id, mac, model) VALUES ('d4', 'synthetic-4', 'test')");
        String rule = "INSERT INTO alert_custom_rule (device_id, id, metric, comparison, amount, days, level, delivery, enabled, "
                + "created_at, updated_at) VALUES ('d4', ?, 'steps', ?, 3000, ?, 'attenzione', 'notifica', 1, 1, 1)";
        assertThat(jdbc.update(rule, "custom-00000001", "below", 3)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update(rule, "custom-00000002", "circa", 3)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(rule, "custom-00000003", "below", 8)).isInstanceOf(DataAccessException.class);
        jdbc.update("INSERT INTO push_registration (device_id, token, key, environment, created_at, updated_at) "
                + "VALUES ('d4', 'ab', 'k', 'sandbox', 1, 1)");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO push_registration (device_id, token, key, environment, created_at, updated_at) "
                + "VALUES ('d4', 'ab', 'k', 'test', 1, 1)")).isInstanceOf(DataAccessException.class);

        // Events written without push columns start from `none`, and the state has its CHECK even as an added column.
        jdbc.update("INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, created_at) "
                + "VALUES ('p1', 'd4', 'hrv', '2026-11-14', 'attenzione', 't', 'b', '/', 1)");
        assertThat(jdbc.queryForObject("SELECT push_state || ' ' || push_attempts FROM alert_event WHERE id = 'p1'", String.class))
                .isEqualTo("none 0");
        assertThatThrownBy(() -> jdbc.update("UPDATE alert_event SET push_state = 'forse' WHERE id = 'p1'"))
                .isInstanceOf(DataAccessException.class);

        jdbc.update("DELETE FROM device WHERE id = 'd4'");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_custom_rule WHERE device_id = 'd4'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_registration WHERE device_id = 'd4'", Integer.class)).isZero();
    }

    @Test
    void connectionUsesWalAndForeignKeys() {
        assertThat(jdbc.queryForObject("PRAGMA journal_mode", String.class)).isEqualToIgnoringCase("wal");
        assertThat(jdbc.queryForObject("PRAGMA foreign_keys", Integer.class)).isEqualTo(1);
    }

    @Test
    void sampleKeyMakesUploadsIdempotent() {
        jdbc.update("INSERT INTO device (id, mac, model) VALUES ('d1', 'synthetic', 'test')");
        String upsert = "INSERT INTO sample (device_id, metric, ts, value) VALUES ('d1', 'HR', 1000, ?) "
                + "ON CONFLICT (device_id, metric, ts) DO NOTHING";

        assertThat(jdbc.update(upsert, 60)).isEqualTo(1);
        // Stesso campione caricato due volte: nessun errore, nessuna riga in piu', valore originale.
        assertThat(jdbc.update(upsert, 61)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT value FROM sample WHERE device_id = 'd1' AND metric = 'HR' AND ts = 1000",
                Double.class)).isEqualTo(60.0);
    }

    @Test
    void foreignKeyAndMetricConstraintsAreEnforced() {
        jdbc.update("INSERT INTO device (id, mac, model) VALUES ('d2', 'synthetic-2', 'test')");

        // Il traduttore di eccezioni di Spring non mappa gli errori di vincolo di SQLite in
        // DataIntegrityViolationException: il tipo e' DataAccessException (UncategorizedSQLException).
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO sample (device_id, metric, ts, value) VALUES ('missing', 'HR', 1, 1)"))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO sample (device_id, metric, ts, value) VALUES ('d2', 'UNKNOWN', 1, 1)"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void healthEndpointIsUp() throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/actuator/health")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"status\":\"UP\"");
    }

    @AfterAll
    static void cleanUp() throws IOException {
        try (var files = Files.walk(DB_DIR)) {
            files.sorted((a, b) -> b.compareTo(a)).forEach(p -> p.toFile().delete());
        }
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
