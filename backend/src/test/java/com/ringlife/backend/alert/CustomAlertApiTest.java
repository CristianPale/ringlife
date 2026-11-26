package com.ringlife.backend.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.ringlife.backend.device.TokenService;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Your own alert rules (ADR 0046) with a real database: creation, change, removal, validation and evaluation next to the
 * built-in rules. Synthetic values only. «Today» is fixed at 14 November 2026, 12:00 in Rome.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CustomAlertApiTest {

    private static final Path DB_DIR = createTempDir();
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);
    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final ObjectMapper JSON = new ObjectMapper();

    @TestConfiguration
    static class FixedClock {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-11-14T11:00:00Z"), ZoneId.of("UTC"));
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("custom-alerts.sqlite").toString());
        registry.add("ringlife.apns.scheduler", () -> "false");
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TokenService tokens;

    @Autowired
    AlertService alerts;

    private String device;
    private String token;

    @BeforeEach
    void freshDevice() {
        for (String table : List.of(
                "alert_event", "alert_rule", "alert_custom_rule", "alert_settings", "push_registration", "plugin_result", "plugin_state",
                "daily_metric", "daily_score", "baseline", "daily_feature", "sleep_stage", "sleep_session", "sample", "sync_log",
                "api_token", "device")) {
            jdbc.update("DELETE FROM " + table);
        }
        device = newDevice();
        token = tokens.issue(device);
    }

    private String newDevice() {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", id, "synthetic-" + id);
        return id;
    }

    // --- synthetic daily results ---

    private void feature(LocalDate day, String name, double value) {
        jdbc.update("INSERT INTO daily_feature (device_id, day, feature, value) VALUES (?, ?, ?, ?)", device, day.toString(), name, value);
    }

    private void baseline(LocalDate day, String feature, double median, double mad) {
        jdbc.update("INSERT INTO baseline (device_id, day, feature, window_days, median, mad, count) VALUES (?, ?, ?, 28, ?, ?, 14)",
                device, day.toString(), feature, median, mad);
    }

    private static long at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ROME).toInstant().toEpochMilli();
    }

    /** A night that is over: a sleep session from 23:00 to 07:00 and a heart rate sample at 07:45, after waking up. */
    private void finishedNight(LocalDate day) {
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?)",
                UUID.randomUUID().toString(), device, at(day.minusDays(1), 23, 0), at(day, 7, 0));
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES (?, 'HR', ?, 70)", device, at(day, 7, 45));
    }

    // --- HTTP ---

    private ResultActions getJson(String path) throws Exception {
        return mvc.perform(get("/api/v1/devices/" + device + path).header("Authorization", "Bearer " + token));
    }

    private ResultActions create(String body) throws Exception {
        return mvc.perform(post("/api/v1/devices/" + device + "/alerts/custom")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions change(String ruleId, String body) throws Exception {
        return mvc.perform(put("/api/v1/devices/" + device + "/alerts/custom/" + ruleId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions remove(String ruleId) throws Exception {
        return mvc.perform(delete("/api/v1/devices/" + device + "/alerts/custom/" + ruleId).header("Authorization", "Bearer " + token));
    }

    private JsonNode body(ResultActions result) throws Exception {
        return JSON.readTree(result.andReturn().getResponse().getContentAsString());
    }

    /** Creates a rule and returns its id. */
    private String created(String body) throws Exception {
        JsonNode config = body(create(body).andExpect(status().isOk()));
        JsonNode custom = config.get("custom");
        return custom.get(custom.size() - 1).get("id").asString();
    }

    private List<String> events() {
        return jdbc.queryForList(
                "SELECT rule_id || ' ' || day FROM alert_event WHERE device_id = ? ORDER BY day, rule_id", String.class, device);
    }

    // --- configuration ---

    @Test
    void theConfigurationListsYourRulesTheMeasuresAndTheLimit() throws Exception {
        getJson("/alerts/config").andExpect(status().isOk())
                .andExpect(jsonPath("$.rules.length()").value(9))
                .andExpect(jsonPath("$.custom.length()").value(0))
                .andExpect(jsonPath("$.maxCustom").value(20))
                .andExpect(jsonPath("$.metrics.length()").value(11))
                .andExpect(jsonPath("$.metrics[0].id").value("resting_hr"))
                .andExpect(jsonPath("$.metrics[0].name").value("Battito a riposo"))
                .andExpect(jsonPath("$.metrics[0].unit").value("battiti al minuto"))
                .andExpect(jsonPath("$.metrics[0].night").value(true))
                .andExpect(jsonPath("$.metrics[0].average").value(true))
                .andExpect(jsonPath("$.metrics[0].value.min").value(30))
                .andExpect(jsonPath("$.metrics[0].value.max").value(120))
                .andExpect(jsonPath("$.metrics[0].value.step").value(1))
                .andExpect(jsonPath("$.metrics[?(@.id=='temperature')].value").value(org.hamcrest.Matchers.contains((Object) null)))
                .andExpect(jsonPath("$.metrics[?(@.id=='temperature')].unit").value(org.hamcrest.Matchers.contains((Object) null)))
                .andExpect(jsonPath("$.metrics[?(@.id=='sleep_hours')].value.step").value(0.5))
                .andExpect(jsonPath("$.metrics[?(@.id=='steps')].night").value(false))
                .andExpect(jsonPath("$.metrics[?(@.id=='steps')].value.max").value(30000));
    }

    @Test
    void aRuleIsCreatedWithItsNameAndDefaults() throws Exception {
        JsonNode config = body(create("""
                { "metric": "steps", "comparison": "below", "amount": 3000, "days": 3, "level": "attenzione" }""")
                .andExpect(status().isOk()));
        JsonNode rule = config.get("custom").get(0);
        assertThat(rule.get("id").asString()).matches("custom-[0-9a-f]{8}");
        assertThat(rule.get("name").asString()).isEqualTo("Passi sotto 3.000 per 3 giorni di fila");
        assertThat(rule.get("metric").asString()).isEqualTo("steps");
        assertThat(rule.get("comparison").asString()).isEqualTo("below");
        assertThat(rule.get("amount").asInt()).isEqualTo(3000);
        assertThat(rule.get("amount").isIntegralNumber()).isTrue();
        assertThat(rule.get("days").asInt()).isEqualTo(3);
        assertThat(rule.get("level").asString()).isEqualTo("attenzione");
        assertThat(rule.get("delivery").asString()).isEqualTo("notifica");
        assertThat(rule.get("enabled").asBoolean()).isTrue();
        assertThat(config.get("rules")).hasSize(9);

        JsonNode second = body(create("""
                { "metric": "resting_hr", "comparison": "above_average", "amount": 1.5, "days": 2, "level": "alto",
                  "delivery": "importante", "enabled": false }""").andExpect(status().isOk())).get("custom");
        assertThat(second).hasSize(2);
        assertThat(second.get(1).get("name").asString()).isEqualTo("Battito a riposo sopra la tua media di 1,5 scostamenti per 2 notti di fila");
        assertThat(second.get(1).get("amount").asDouble()).isEqualTo(1.5);
        assertThat(second.get(1).get("delivery").asString()).isEqualTo("importante");
        assertThat(second.get(1).get("enabled").asBoolean()).isFalse();
        assertThat(second.get(0).get("id").asString()).isNotEqualTo(second.get(1).get("id").asString());
    }

    @Test
    void invalidRulesAreRefusedAndNothingIsWritten() throws Exception {
        List<String> bad = List.of(
                "{ \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3 }",
                "{ \"metric\": \"calorie\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"circa\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below_average\", \"amount\": 1, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"temperature\", \"comparison\": \"above\", \"amount\": 37, \"days\": 1, \"level\": \"attenzione\" }",
                "{ \"metric\": \"spo2\", \"comparison\": \"below\", \"amount\": 92, \"days\": 1, \"level\": \"alto\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 100, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3100, \"days\": 3, \"level\": \"attenzione\" }",
                "{ \"metric\": \"resting_hr\", \"comparison\": \"above\", \"amount\": 121, \"days\": 1, \"level\": \"attenzione\" }",
                "{ \"metric\": \"hrv\", \"comparison\": \"below_average\", \"amount\": 3.5, \"days\": 1, \"level\": \"attenzione\" }",
                "{ \"metric\": \"hrv\", \"comparison\": \"below_average\", \"amount\": 0.5, \"days\": 1, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 0, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 8, \"level\": \"attenzione\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"rosso\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"alto\", \"delivery\": \"push\" }",
                "{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": \"tanti\", \"days\": 3, \"level\": \"alto\" }");
        for (String body : bad) {
            create(body).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isNotEmpty());
        }
        create("{ \"metric\": \"temperature\", \"comparison\": \"above\", \"amount\": 37, \"days\": 1, \"level\": \"alto\" }")
                .andExpect(jsonPath("$.error").value("Parametro non valido: comparison"));
        create("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3100, \"days\": 3, \"level\": \"alto\" }")
                .andExpect(jsonPath("$.error").value("Parametro non valido: amount"));
        create("{ \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"alto\" }")
                .andExpect(jsonPath("$.error").value("Campo obbligatorio: metric"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_custom_rule", Integer.class)).isZero();
    }

    @Test
    void theTwentyFirstRuleIsRefused() throws Exception {
        for (int i = 0; i < 20; i++) {
            create("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": " + (1000 + 500 * i)
                    + ", \"days\": 3, \"level\": \"attenzione\" }").andExpect(status().isOk());
        }
        create("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 500, \"days\": 3, \"level\": \"attenzione\" }")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Al massimo 20 avvisi tuoi"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_custom_rule WHERE device_id = ?", Integer.class, device)).isEqualTo(20);
        // Another device has its own twenty.
        device = newDevice();
        token = tokens.issue(device);
        create("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 500, \"days\": 3, \"level\": \"attenzione\" }")
                .andExpect(status().isOk());
    }

    @Test
    void aChangeTouchesOnlyTheFieldsThatArePresentAndChecksTheWholeRule() throws Exception {
        String id = created("{ \"metric\": \"resting_hr\", \"comparison\": \"above\", \"amount\": 70, \"days\": 2, \"level\": \"attenzione\" }");
        JsonNode rule = body(change(id, "{ \"amount\": 75, \"delivery\": \"elenco\", \"enabled\": false }").andExpect(status().isOk()))
                .get("custom").get(0);
        assertThat(rule.get("id").asString()).isEqualTo(id);
        assertThat(rule.get("name").asString()).isEqualTo("Battito a riposo sopra 75 battiti al minuto per 2 notti di fila");
        assertThat(rule.get("days").asInt()).isEqualTo(2);
        assertThat(rule.get("delivery").asString()).isEqualTo("elenco");
        assertThat(rule.get("enabled").asBoolean()).isFalse();

        // The temperature has no value comparison: the measure alone cannot change.
        change(id, "{ \"metric\": \"temperature\" }").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Parametro non valido: comparison"));
        change(id, "{ \"metric\": \"temperature\", \"comparison\": \"above_average\", \"amount\": 2 }").andExpect(status().isOk())
                .andExpect(jsonPath("$.custom[0].name").value("Temperatura della notte sopra la tua media di 2 scostamenti per 2 notti di fila"));
        change(id, "{ \"days\": 9 }").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Parametro non valido: days"));
        assertThat(jdbc.queryForObject("SELECT days FROM alert_custom_rule WHERE id = ?", Integer.class, id)).isEqualTo(2);

        change("custom-00000000", "{ \"days\": 3 }").andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("Regola sconosciuta"));
        remove("custom-00000000").andExpect(status().isNotFound());
    }

    @Test
    void anotherDevicesRuleIsNotFoundAndItsTokenIsRefused() throws Exception {
        String id = created("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }");
        String mine = device;
        String myToken = token;
        device = newDevice();
        token = tokens.issue(device);
        change(id, "{ \"days\": 1 }").andExpect(status().isNotFound());
        remove(id).andExpect(status().isNotFound());
        getJson("/alerts/config").andExpect(jsonPath("$.custom.length()").value(0));
        mvc.perform(post("/api/v1/devices/" + mine + "/alerts/custom")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"alto\" }"))
                .andExpect(status().isUnauthorized());
        device = mine;
        token = myToken;
        getJson("/alerts/config").andExpect(jsonPath("$.custom.length()").value(1));
    }

    @Test
    void theBuiltInConfigurationStillRefusesUnknownRulesYoursIncluded() throws Exception {
        String id = created("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }");
        mvc.perform(put("/api/v1/devices/" + device + "/alerts/config")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ \"rules\": { \"" + id + "\": { \"enabled\": false } } }"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Regola sconosciuta"));
    }

    // --- evaluation ---

    @Test
    void aNightMeasureWaitsForTheNightAndGivesOneEventPerDay() throws Exception {
        feature(TODAY, "resting_hr", 66);
        String id = created("{ \"metric\": \"resting_hr\", \"comparison\": \"above\", \"amount\": 60, \"days\": 1, \"level\": \"alto\" }");
        // The night of today is not over: nothing yet.
        assertThat(events()).isEmpty();

        finishedNight(TODAY);
        alerts.evaluateToday(device);
        alerts.evaluateToday(device);
        assertThat(events()).containsExactly(id + " 2026-11-14");
        JsonNode event = body(getJson("/alerts").andExpect(status().isOk())).get("events").get(0);
        assertThat(event.get("rule").asString()).isEqualTo(id);
        assertThat(event.get("level").asString()).isEqualTo("alto");
        assertThat(event.get("title").asString()).isEqualTo("Battito a riposo sopra 60 battiti al minuto");
        assertThat(event.get("body").asString()).isEqualTo("66 battiti al minuto, sopra 60. Avviso creato da te.");
        assertThat(event.get("route").asString()).isEqualTo("/indici/recupero");
        assertThat(event.get("push").asString()).isEqualTo("none");
        String values = jdbc.queryForObject("SELECT values_json FROM alert_event WHERE device_id = ?", String.class, device);
        assertThat(JSON.readTree(values).get("delivery").asString()).isEqualTo("notifica");
        assertThat(JSON.readTree(values).get("ruleVersion").asString()).isEqualTo("1");
    }

    @Test
    void aDayMeasureLooksAtYesterdayRightAfterTheChangeAndNeverAtToday() throws Exception {
        for (int i = 0; i <= 4; i++) {
            feature(TODAY.minusDays(i), "steps", 2000);
        }
        String id = created("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 3, \"level\": \"attenzione\" }");
        assertThat(events()).containsExactly(id + " 2026-11-13");
        JsonNode event = body(getJson("/alerts")).get("events").get(0);
        assertThat(event.get("title").asString()).isEqualTo("Passi sotto 3.000 da 4 giorni");
        assertThat(event.get("body").asString()).isEqualTo("2.000 passi, sotto 3.000 per il quarto giorno di fila. Avviso creato da te.");
        assertThat(event.get("route").asString()).isEqualTo("/indici/movimento");

        // 11 November has only two days in a row behind it.
        alerts.evaluateFrom(device, TODAY.minusDays(3));
        assertThat(events()).containsExactly(id + " 2026-11-12", id + " 2026-11-13");
    }

    @Test
    void anAverageRuleIsSilentInCalibrationAndARuleThatIsOffRaisesNothing() throws Exception {
        finishedNight(TODAY);
        feature(TODAY, "hrv_night", 20);
        String id = created("{ \"metric\": \"hrv\", \"comparison\": \"below_average\", \"amount\": 1, \"days\": 1, \"level\": \"attenzione\" }");
        assertThat(events()).isEmpty();

        // Your average arrives: about −2 deviations.
        baseline(TODAY, "hrv_night", 40, 6.7);
        change(id, "{ \"enabled\": false }").andExpect(status().isOk());
        assertThat(events()).isEmpty();
        change(id, "{ \"enabled\": true }").andExpect(status().isOk());
        assertThat(events()).containsExactly(id + " 2026-11-14");
        JsonNode event = body(getJson("/alerts")).get("events").get(0);
        assertThat(event.get("title").asString()).isEqualTo("Variabilità del battito (HRV) sotto il tuo solito");
        assertThat(event.get("body").asString()).isEqualTo("−20 millisecondi rispetto alla tua media. Avviso creato da te.");
    }

    @Test
    void removingARuleKeepsItsEvents() throws Exception {
        feature(TODAY.minusDays(1), "steps", 1000);
        String id = created("{ \"metric\": \"steps\", \"comparison\": \"below\", \"amount\": 3000, \"days\": 1, \"level\": \"attenzione\" }");
        assertThat(events()).containsExactly(id + " 2026-11-13");
        remove(id).andExpect(status().isOk()).andExpect(jsonPath("$.custom.length()").value(0));
        assertThat(events()).containsExactly(id + " 2026-11-13");
        assertThat(body(getJson("/alerts")).get("events")).hasSize(1);
        // Gone for good: evaluating again does nothing more, and the rule cannot be removed twice.
        alerts.evaluateFrom(device, TODAY.minusDays(5));
        assertThat(events()).hasSize(1);
        remove(id).andExpect(status().isNotFound());
    }

    @Test
    void sleepAndScoreRulesOpenTheirPages() throws Exception {
        finishedNight(TODAY);
        feature(TODAY, "sleep_asleep_min", 300);
        jdbc.update("INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                + "VALUES (?, ?, 'stress', 'v1', 80, '[]', 0)", device, TODAY.minusDays(1).toString());
        String sleep = created("{ \"metric\": \"sleep_hours\", \"comparison\": \"below\", \"amount\": 6, \"days\": 1, \"level\": \"attenzione\" }");
        String stress = created("{ \"metric\": \"stress_score\", \"comparison\": \"above\", \"amount\": 70, \"days\": 1, \"level\": \"attenzione\" }");
        assertThat(jdbc.queryForObject("SELECT route FROM alert_event WHERE rule_id = ?", String.class, sleep)).isEqualTo("/tabs/sonno");
        assertThat(jdbc.queryForObject("SELECT route FROM alert_event WHERE rule_id = ?", String.class, stress)).isEqualTo("/indici/stress");
        assertThat(jdbc.queryForObject("SELECT title FROM alert_event WHERE rule_id = ?", String.class, sleep)).isEqualTo("Ore di sonno sotto 6");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-custom-alerts");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
