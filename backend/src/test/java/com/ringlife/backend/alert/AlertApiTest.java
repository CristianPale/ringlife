package com.ringlife.backend.alert;

import static org.assertj.core.api.Assertions.assertThat;
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

import com.ringlife.backend.compute.FinishedNights;
import com.ringlife.backend.device.TokenService;
import com.ringlife.backend.plugin.PluginService;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Alerts (ADR 0045) with a real database: configuration, evaluation on stored daily results, events and «seen».
 * Synthetic values only. «Today» is fixed at 14 November 2026, 12:00 in Rome.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AlertApiTest {

    private static final Path DB_DIR = createTempDir();
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);
    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final long MIN = 60_000L;
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
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("alerts.sqlite").toString());
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TokenService tokens;

    @Autowired
    AlertService alerts;

    @Autowired
    PluginService plugins;

    @Autowired
    FinishedNights nights;

    private String device;
    private String token;

    @BeforeEach
    void freshDevice() {
        for (String table : List.of(
                "alert_event", "alert_rule", "alert_settings", "plugin_result", "plugin_state", "daily_metric", "daily_score",
                "baseline", "daily_feature", "sleep_stage", "sleep_session", "sample", "sync_log", "api_token", "device")) {
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

    private void metric(LocalDate day, String name, double value, String unit, String detail) {
        jdbc.update("INSERT INTO daily_metric (device_id, day, metric, algo_version, value, unit, detail, computed_at) "
                + "VALUES (?, ?, ?, 'v1', ?, ?, ?, 0)", device, day.toString(), name, value, unit, detail);
    }

    private void score(LocalDate day, String kind, int value) {
        jdbc.update("INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                + "VALUES (?, ?, ?, 'v1', ?, '[]', 0)", device, day.toString(), kind, value);
    }

    private static long at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ROME).toInstant().toEpochMilli();
    }

    private void sample(String metric, long ts, double value) {
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", device, metric, ts, value);
    }

    /** A night that is over: a sleep session from 23:00 to 07:00 and a heart rate sample at 07:45, after waking up. */
    private void finishedNight(LocalDate day) {
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?)",
                UUID.randomUUID().toString(), device, at(day.minusDays(1), 23, 0), at(day, 7, 0));
        sample("HR", at(day, 7, 45), 70);
    }

    /**
     * A finished night with its temperature 0,6 °C over a median of 34,3 with a spread of about 0,5: about +1,2
     * deviations.
     */
    private void warmNight(LocalDate day) {
        finishedNight(day);
        feature(day, "temp_night", 34.9);
        baseline(day, "temp_night", 34.3, 0.34);
        metric(day, "temp_deviation", 0.6, "C", null);
    }

    // --- HTTP ---

    private ResultActions getJson(String path) throws Exception {
        return mvc.perform(get("/api/v1/devices/" + device + path).header("Authorization", "Bearer " + token));
    }

    private ResultActions putConfig(String body) throws Exception {
        return mvc.perform(put("/api/v1/devices/" + device + "/alerts/config")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions seen(String body) throws Exception {
        return mvc.perform(post("/api/v1/devices/" + device + "/alerts/seen")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private JsonNode events() throws Exception {
        return JSON.readTree(getJson("/alerts").andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private int eventCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM alert_event WHERE device_id = ?", Integer.class, device);
    }

    // --- configuration ---

    @Test
    void theConfigurationStartsFromTheDefaultsOfTheAdr() throws Exception {
        getJson("/alerts/config").andExpect(status().isOk())
                .andExpect(jsonPath("$.settings.quietStart").value("22:30"))
                .andExpect(jsonPath("$.settings.quietEnd").value("07:00"))
                .andExpect(jsonPath("$.settings.lockScreen").value("breve"))
                .andExpect(jsonPath("$.settings.homeAssistant").value(false))
                .andExpect(jsonPath("$.rules.length()").value(9))
                .andExpect(jsonPath("$.rules[0].id").value("fatigue"))
                .andExpect(jsonPath("$.rules[0].name").value("Segnali di affaticamento"))
                .andExpect(jsonPath("$.rules[0].level").value("alto"))
                .andExpect(jsonPath("$.rules[0].usesAverage").value(true))
                .andExpect(jsonPath("$.rules[0].params.sensitivity").value(false))
                .andExpect(jsonPath("$.rules[0].params.days").isEmpty())
                .andExpect(jsonPath("$.rules[0].sensitivity").isEmpty())
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].sensitivity").value("normale"))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].days").value(2))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].params.days.min").value(2))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].params.days.max").value(7))
                .andExpect(jsonPath("$.rules[?(@.id=='resting-hr')].days").value(3))
                .andExpect(jsonPath("$.rules[?(@.id=='recovery-low')].threshold").value(70))
                .andExpect(jsonPath("$.rules[?(@.id=='recovery-low')].params.threshold.unit").value("punti"))
                .andExpect(jsonPath("$.rules[?(@.id=='migraine-risk')].usesAverage").value(false))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].enabled").value(false))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].threshold").value(6))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].params.threshold.step").value(0.5))
                .andExpect(jsonPath("$.rules[?(@.id=='steps-low')].enabled").value(false))
                .andExpect(jsonPath("$.rules[?(@.id=='steps-low')].threshold").value(4000))
                .andExpect(jsonPath("$.rules[?(@.id=='steps-low')].delivery").value("notifica"));
    }

    @Test
    void aChangeTouchesOnlyTheFieldsThatArePresent() throws Exception {
        putConfig("""
                { "settings": { "quietStart": "23:00", "homeAssistant": true },
                  "rules": { "temperature": { "sensitivity": "sensibile", "days": 3 },
                             "sleep-debt": { "enabled": true, "threshold": 5.5, "delivery": "elenco" } } }""")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.settings.quietStart").value("23:00"))
                .andExpect(jsonPath("$.settings.quietEnd").value("07:00"))
                .andExpect(jsonPath("$.settings.lockScreen").value("breve"))
                .andExpect(jsonPath("$.settings.homeAssistant").value(true))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].sensitivity").value("sensibile"))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].days").value(3))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].enabled").value(true))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].threshold").value(5.5))
                .andExpect(jsonPath("$.rules[?(@.id=='sleep-debt')].delivery").value("elenco"));

        putConfig("{ \"rules\": { \"temperature\": { \"enabled\": false } }, \"settings\": { \"lockScreen\": \"generico\" } }")
                .andExpect(status().isOk());
        getJson("/alerts/config")
                .andExpect(jsonPath("$.settings.quietStart").value("23:00"))
                .andExpect(jsonPath("$.settings.lockScreen").value("generico"))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].enabled").value(false))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].sensitivity").value("sensibile"))
                .andExpect(jsonPath("$.rules[?(@.id=='temperature')].days").value(3))
                .andExpect(jsonPath("$.rules[?(@.id=='hrv')].enabled").value(true));
    }

    @Test
    void anUnknownRuleOrAValueOutOfRangeIsRefusedAndNothingIsWritten() throws Exception {
        List<String> bad = List.of(
                "{ \"rules\": { \"sconosciuta\": { \"enabled\": true } } }",
                "{ \"rules\": { \"temperature\": { \"days\": 1 } } }",
                "{ \"rules\": { \"temperature\": { \"days\": 8 } } }",
                "{ \"rules\": { \"temperature\": { \"sensitivity\": \"alta\" } } }",
                "{ \"rules\": { \"temperature\": { \"threshold\": 3 } } }",
                "{ \"rules\": { \"fatigue\": { \"sensitivity\": \"normale\" } } }",
                "{ \"rules\": { \"recovery-low\": { \"threshold\": 95 } } }",
                "{ \"rules\": { \"steps-low\": { \"threshold\": 100 } } }",
                "{ \"rules\": { \"hrv\": { \"delivery\": \"push\" } } }",
                "{ \"rules\": { \"temperature\": { \"days\": \"tre\" } } }",
                "{ \"settings\": { \"quietStart\": \"25:00\" } }",
                "{ \"settings\": { \"quietEnd\": \"7:00\" } }",
                "{ \"settings\": { \"lockScreen\": \"tutto\" } }",
                "{ \"settings\": { \"homeAssistant\": true }, \"rules\": { \"hrv\": { \"days\": 0 } } }");
        for (String body : bad) {
            putConfig(body).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isNotEmpty());
        }
        putConfig("{ \"rules\": { \"sconosciuta\": {} } }").andExpect(jsonPath("$.error").value("Regola sconosciuta"));
        putConfig("{ \"rules\": { \"temperature\": { \"days\": 9 } } }").andExpect(jsonPath("$.error").value("Parametro non valido: temperature.days"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_settings", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM alert_rule", Integer.class)).isZero();
    }

    @Test
    void anotherDevicesTokenIsRefused() throws Exception {
        String other = tokens.issue(newDevice());
        mvc.perform(get("/api/v1/devices/" + device + "/alerts/config").header("Authorization", "Bearer " + other))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices/" + device + "/alerts")).andExpect(status().isUnauthorized());
    }

    // --- evaluation and events ---

    @Test
    void twoWarmNightsInARowBecomeOneEventWithItsTextAndPage() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateFrom(device, TODAY.minusDays(1));

        JsonNode body = events();
        assertThat(body.get("unseen").asInt()).isEqualTo(1);
        assertThat(body.get("events")).hasSize(1);
        JsonNode event = body.get("events").get(0);
        assertThat(event.get("rule").asString()).isEqualTo("temperature");
        assertThat(event.get("day").asString()).isEqualTo("2026-11-14");
        assertThat(event.get("level").asString()).isEqualTo("attenzione");
        assertThat(event.get("title").asString()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(event.get("body").asString())
                .isEqualTo("+0,6 °C rispetto alla tua media, la seconda notte di fila. Riposo e liquidi possono aiutare.");
        assertThat(event.get("route").asString()).isEqualTo("/indici/recupero");
        assertThat(event.get("createdAt").asLong()).isEqualTo(Instant.parse("2026-11-14T11:00:00Z").toEpochMilli());
        assertThat(event.get("deliverAfter").isNull()).isTrue();
        assertThat(event.get("seenAt").isNull()).isTrue();
        assertThat(event.get("id").asString()).isNotBlank();
        String values = jdbc.queryForObject("SELECT values_json FROM alert_event WHERE device_id = ?", String.class, device);
        assertThat(JSON.readTree(values).get("ruleVersion").asString()).isEqualTo("1");
    }

    @Test
    void thereIsAtMostOneEventPerRuleAndDayAndItIsNeverRewritten() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateFrom(device, TODAY);
        alerts.evaluateFrom(device, TODAY);
        assertThat(eventCount()).isEqualTo(1);

        // Warmer still: the event of today stays as it was.
        jdbc.update("UPDATE daily_metric SET value = 1.1 WHERE device_id = ? AND day = ?", device, TODAY.toString());
        jdbc.update("UPDATE daily_feature SET value = 35.4 WHERE device_id = ? AND day = ?", device, TODAY.toString());
        alerts.evaluateToday(device);
        assertThat(eventCount()).isEqualTo(1);
        assertThat(events().get("events").get(0).get("body").asString()).startsWith("+0,6 °C");
    }

    @Test
    void theRulesOnYourAverageAreSilentDuringCalibration() {
        feature(TODAY, "temp_night", 36.0);
        feature(TODAY, "resting_hr", 70);
        feature(TODAY, "hrv_night", 10);
        alerts.evaluateFrom(device, TODAY.minusDays(5));
        assertThat(eventCount()).isZero();
    }

    @Test
    void aRuleThatIsOffRaisesNothingAndTheSleepDebtWaitsForTheEvening() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        metric(TODAY, "sleep_debt", 7.5, "h", null);
        putConfig("{ \"rules\": { \"temperature\": { \"enabled\": false }, \"sleep-debt\": { \"enabled\": true } } }")
                .andExpect(status().isOk());
        // The change evaluated today right away.
        JsonNode body = events();
        assertThat(body.get("events")).hasSize(1);
        JsonNode event = body.get("events").get(0);
        assertThat(event.get("rule").asString()).isEqualTo("sleep-debt");
        assertThat(event.get("route").asString()).isEqualTo("/tabs/sonno");
        assertThat(event.get("deliverAfter").asLong()).isEqualTo(Instant.parse("2026-11-14T20:00:00Z").toEpochMilli());
    }

    @Test
    void lowRecoveryAndLowStepsRunOverTheRecomputedDays() throws Exception {
        for (int i = 0; i < 4; i++) {
            finishedNight(TODAY.minusDays(i));
            score(TODAY.minusDays(i), "recovery", 60);
            feature(TODAY.minusDays(i), "steps", 2000);
        }
        putConfig("{ \"rules\": { \"steps-low\": { \"enabled\": true } } }").andExpect(status().isOk());
        alerts.evaluateFrom(device, TODAY.minusDays(3));
        List<String> found = jdbc.queryForList(
                "SELECT rule_id || ' ' || day FROM alert_event WHERE device_id = ? ORDER BY rule_id, day", String.class, device);
        // Recovery: from the third day of the run. Steps: only finished days, so not today.
        assertThat(found).containsExactly(
                "recovery-low 2026-11-13", "recovery-low 2026-11-14", "steps-low 2026-11-13");
    }

    @Test
    void theMigraineAlertComesFromThePluginOnlyWhileThePluginIsOn() throws Exception {
        // A high risk from the real plugin: short sleep 20, low HRV 20, high resting heart rate 10, sleep debt 10,
        // irregular sleep 10 = 70.
        finishedNight(TODAY);
        feature(TODAY, "sleep_asleep_min", 300);
        feature(TODAY, "hrv_night", 30);
        baseline(TODAY, "hrv_night", 50, 5);
        feature(TODAY, "resting_hr", 65);
        baseline(TODAY, "resting_hr", 55, 2);
        metric(TODAY, "sleep_debt", 5.0, "h", null);
        score(TODAY, "sleep_regularity", 40);
        plugins.evaluateAll(device);
        alerts.evaluateToday(device);

        JsonNode migraine = null;
        for (JsonNode event : events().get("events")) {
            if ("migraine-risk".equals(event.get("rule").asString())) {
                migraine = event;
            }
        }
        assertThat(migraine).isNotNull();
        assertThat(migraine.get("level").asString()).isEqualTo("alto");
        assertThat(migraine.get("route").asString()).isEqualTo("/plugin/migraine");
        assertThat(migraine.get("title").asString()).isEqualTo("Rischio emicrania alto oggi");
        assertThat(migraine.get("body").asString()).startsWith("Stima 70 su 100. Pesano sonno corto");

        // Same day, plugin off: the stored result is not read.
        jdbc.update("DELETE FROM alert_event");
        jdbc.update("INSERT INTO plugin_state (device_id, plugin_id, enabled, config, updated_at) VALUES (?, 'migraine', 0, '{}', 0)", device);
        alerts.evaluateToday(device);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM alert_event WHERE device_id = ? AND rule_id = 'migraine-risk'", Integer.class, device)).isZero();
    }

    @Test
    void theMigraineRuleOffIgnoresThePluginAlert() throws Exception {
        finishedNight(TODAY);
        jdbc.update("INSERT INTO plugin_result (device_id, plugin_id, day, version, payload, computed_at) VALUES (?, 'migraine', ?, '3', ?, 0)",
                device, TODAY.toString(),
                "{\"cards\":[],\"insights\":[],\"entities\":[],\"headline\":null,\"alerts\":[{\"rule\":\"migraine-risk\","
                        + "\"title\":\"Rischio emicrania alto oggi\",\"body\":\"Stima 75 su 100.\",\"values\":{\"score\":75}}]}");
        putConfig("{ \"rules\": { \"migraine-risk\": { \"enabled\": false } } }").andExpect(status().isOk());
        alerts.evaluateToday(device);
        assertThat(eventCount()).isZero();
        putConfig("{ \"rules\": { \"migraine-risk\": { \"enabled\": true } } }").andExpect(status().isOk());
        assertThat(eventCount()).isEqualTo(1);
    }

    @Test
    void eventsAreListedSinceAnInstantAndMarkedAsSeen() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        for (int i = 0; i < 3; i++) {
            score(TODAY.minusDays(i), "recovery", 60);
        }
        alerts.evaluateFrom(device, TODAY);
        assertThat(eventCount()).isEqualTo(2);

        long created = Instant.parse("2026-11-14T11:00:00Z").toEpochMilli();
        getJson("/alerts?since=" + created).andExpect(status().isOk()).andExpect(jsonPath("$.events.length()").value(2));
        getJson("/alerts?since=" + (created + 1)).andExpect(status().isOk())
                .andExpect(jsonPath("$.events.length()").value(0))
                .andExpect(jsonPath("$.unseen").value(2));
        getJson("/alerts?since=ieri").andExpect(status().isBadRequest());
        getJson("/alerts?since=-5").andExpect(status().isBadRequest());

        String first = events().get("events").get(0).get("id").asString();
        seen("{ \"ids\": [\"" + first + "\", \"sconosciuto\"] }").andExpect(status().isOk())
                .andExpect(jsonPath("$.marked").value(1))
                .andExpect(jsonPath("$.unseen").value(1));
        seen("{ \"ids\": [\"" + first + "\"] }").andExpect(jsonPath("$.marked").value(0));
        JsonNode after = events();
        assertThat(after.get("unseen").asInt()).isEqualTo(1);
        for (JsonNode event : after.get("events")) {
            assertThat(event.get("seenAt").isNull()).isEqualTo(!event.get("id").asString().equals(first));
        }
        seen("{ \"all\": true }").andExpect(status().isOk()).andExpect(jsonPath("$.marked").value(1)).andExpect(jsonPath("$.unseen").value(0));
        seen("{}").andExpect(status().isBadRequest());
        seen("{ \"all\": false, \"ids\": [] }").andExpect(status().isBadRequest());
    }

    @Test
    void anotherDevicesEventsAreNeitherListedNorMarked() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateToday(device);
        String mine = device;
        String myToken = token;
        device = newDevice();
        token = tokens.issue(device);
        assertThat(events().get("events")).isEmpty();
        seen("{ \"all\": true }").andExpect(jsonPath("$.marked").value(0));
        device = mine;
        token = myToken;
        assertThat(events().get("unseen").asInt()).isEqualTo(1);
    }

    @Test
    void withoutSinceTheListCoversTheLastThirtyDays() throws Exception {
        jdbc.update("INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, values_json, created_at) "
                        + "VALUES ('old', ?, 'hrv', '2026-10-01', 'attenzione', 'Vecchio', 'Vecchio.', '/indici/recupero', '{}', ?)",
                device, Instant.parse("2026-10-01T08:00:00Z").toEpochMilli());
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateToday(device);
        JsonNode body = events();
        assertThat(body.get("events")).hasSize(1);
        assertThat(body.get("unseen").asInt()).isEqualTo(2);
        getJson("/alerts?since=0").andExpect(jsonPath("$.events.length()").value(2))
                .andExpect(jsonPath("$.events[0].rule").value("temperature"))
                .andExpect(jsonPath("$.events[1].id").value("old"));
    }

    @Test
    void theHomeAssistantSummaryExistsOnlyWhenSwitchedOn() throws Exception {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateToday(device);
        assertThat(alerts.homeAssistantSummary(device)).isEmpty();
        putConfig("{ \"settings\": { \"homeAssistant\": true } }").andExpect(status().isOk());
        AlertService.HaSummary summary = alerts.homeAssistantSummary(device).orElseThrow();
        assertThat(summary.unseen()).isEqualTo(1);
        assertThat(summary.title()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(summary.level()).isEqualTo("attenzione");
        assertThat(summary.day()).isEqualTo("2026-11-14");
    }

    // --- nights not over yet (ADR 0034) ---

    private ResultActions upload(String path, String body) throws Exception {
        return mvc.perform(post("/api/v1/devices/" + device + path)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private static String samples(String metric, double value, long... times) {
        StringBuilder body = new StringBuilder("{ \"tzOffsetMin\": 60, \"samples\": [");
        for (int i = 0; i < times.length; i++) {
            body.append(i == 0 ? "" : ", ").append("{ \"metric\": \"").append(metric).append("\", \"ts\": ").append(times[i])
                    .append(", \"value\": ").append(value).append(" }");
        }
        return body.append("] }").toString();
    }

    private static String night(long start, long end) {
        return "{ \"tzOffsetMin\": 60, \"sessions\": [ { \"start\": " + start + ", \"end\": " + end
                + ", \"stages\": [ { \"stage\": \"light\", \"start\": " + start + ", \"end\": " + end + " } ] } ] }";
    }

    private int temperatureEvents() {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM alert_event WHERE device_id = ? AND rule_id = 'temperature'", Integer.class, device);
    }

    @Test
    void aNightReadBeforeWakingRaisesNothingUntilALaterUploadCompletesIt() throws Exception {
        // Your average: twelve nights between 34,2 and 34,4 °C (median 34,3).
        for (int i = 2; i <= 13; i++) {
            feature(TODAY.minusDays(i), "temp_night", i % 2 == 0 ? 34.2 : 34.4);
        }
        long start = at(TODAY.minusDays(1), 23, 0);

        // Read at 03:00: the night ends at 03:00 and nothing comes after it.
        upload("/sleep", night(start, at(TODAY, 3, 0))).andExpect(status().isOk());
        upload("/samples", samples("TEMP", 34.9, at(TODAY.minusDays(1), 23, 30), at(TODAY, 0, 30), at(TODAY, 1, 30), at(TODAY, 2, 30)))
                .andExpect(status().isOk());
        upload("/samples", samples("HR", 58, at(TODAY, 2, 50))).andExpect(status().isOk());
        // The computation already sees the warm night: only the gate keeps the alert back.
        assertThat(jdbc.queryForObject("SELECT value FROM daily_feature WHERE device_id = ? AND day = ? AND feature = 'temp_night'",
                Double.class, device, TODAY.toString())).isEqualTo(34.9);
        assertThat(nights.isFinished(device, TODAY)).isFalse();
        assertThat(temperatureEvents()).isZero();

        // The morning reading: the same night, longer, and the ring went on recording after waking up.
        upload("/sleep", night(start, at(TODAY, 7, 0))).andExpect(status().isOk());
        assertThat(temperatureEvents()).isZero();
        upload("/samples", samples("TEMP", 34.9, at(TODAY, 3, 30), at(TODAY, 4, 30), at(TODAY, 5, 30))).andExpect(status().isOk());
        upload("/samples", samples("HR", 72, at(TODAY, 7, 10), at(TODAY, 7, 35))).andExpect(status().isOk());
        assertThat(nights.isFinished(device, TODAY)).isTrue();
        assertThat(temperatureEvents()).isEqualTo(1);
        JsonNode event = events().get("events").get(0);
        assertThat(event.get("day").asString()).isEqualTo("2026-11-14");
        assertThat(event.get("body").asString()).isEqualTo("+0,6 °C rispetto alla tua media. Riposo e liquidi possono aiutare.");
    }

    @Test
    void theNightIsOverOnlyWithSamplesThirtyMinutesAfterItsEnd() {
        assertThat(FinishedNights.FINISHED_AFTER_MINUTES).isEqualTo(30);
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES ('n1', ?, ?, ?)",
                device, at(TODAY.minusDays(1), 23, 0), at(TODAY, 7, 0));
        assertThat(nights.isFinished(device, TODAY)).isFalse();
        sample("HR", at(TODAY, 7, 0) + 29 * MIN, 70);
        assertThat(nights.isFinished(device, TODAY)).isFalse();
        sample("STEPS", at(TODAY, 7, 0) + 30 * MIN, 120);
        assertThat(nights.isFinished(device, TODAY)).isTrue();
        // No sleep session ending that day: never over.
        assertThat(nights.isFinished(device, TODAY.minusDays(1))).isFalse();
    }

    @Test
    void aDayWithoutASleepSessionRaisesNoNightAlertButStepsStillCount() throws Exception {
        for (int i = 0; i < 4; i++) {
            LocalDate day = TODAY.minusDays(i);
            feature(day, "temp_night", 34.9);
            baseline(day, "temp_night", 34.3, 0.34);
            metric(day, "temp_deviation", 0.6, "C", null);
            score(day, "recovery", 50);
            metric(day, "strain_level", 2, "level", "{\"level\":\"high\",\"count\":3}");
            feature(day, "steps", 2000);
        }
        putConfig("{ \"rules\": { \"steps-low\": { \"enabled\": true } } }").andExpect(status().isOk());
        alerts.evaluateFrom(device, TODAY.minusDays(3));
        assertThat(jdbc.queryForList("SELECT rule_id FROM alert_event WHERE device_id = ?", String.class, device))
                .containsExactly("steps-low");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-alerts");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
