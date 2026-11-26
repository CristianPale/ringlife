package com.ringlife.backend.plugin;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;

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
import org.springframework.test.web.servlet.ResultActions;

import com.ringlife.backend.compute.DailyComputationService;
import com.ringlife.backend.device.TokenService;

/** API dei plugin e valutazione (ADR 0013), con un database vero e dati sintetici. */
@SpringBootTest
@AutoConfigureMockMvc
class PluginApiTest {

    private static final Path DB_DIR = createTempDir();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("plugins.sqlite").toString());
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TokenService tokens;

    @Autowired
    DailyComputationService computation;

    @Autowired
    PluginService plugins;

    private String device;
    private String token;

    @BeforeEach
    void freshDevice() {
        jdbc.update("DELETE FROM plugin_result");
        jdbc.update("DELETE FROM plugin_state");
        jdbc.update("DELETE FROM daily_score");
        jdbc.update("DELETE FROM daily_feature");
        jdbc.update("DELETE FROM journal_entry");
        jdbc.update("DELETE FROM api_token");
        jdbc.update("DELETE FROM device");
        device = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", device, "synthetic-" + device);
        token = tokens.issue(device);
    }

    private ResultActions list() throws Exception {
        return mvc.perform(get("/api/v1/devices/" + device + "/plugins").header("Authorization", "Bearer " + token));
    }

    private tools.jackson.databind.JsonNode pluginNode(String id) throws Exception {
        String body = list().andReturn().getResponse().getContentAsString();
        for (tools.jackson.databind.JsonNode node : new tools.jackson.databind.ObjectMapper().readTree(body)) {
            if (id.equals(node.get("manifest").get("id").asString())) {
                return node;
            }
        }
        throw new AssertionError("plugin non trovato: " + id);
    }

    private ResultActions update(String plugin, String body) throws Exception {
        return mvc.perform(put("/api/v1/devices/" + device + "/plugins/" + plugin)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    /** Sette giorni finiti di sonno a 80. */
    private void aWeekOfSleep() {
        LocalDate today = computation.today();
        for (int i = 1; i <= 7; i++) {
            jdbc.update(
                    "INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                            + "VALUES (?, ?, 'sleep', 'v1', 80, '[]', 0)",
                    device, today.minusDays(i).toString());
        }
    }

    @Test
    void listsEveryRegisteredPluginOnWithItsManifestAndNoResultYet() throws Exception {
        list().andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].manifest.name").value("Report settimanale"))
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].enabled").value(true))
                .andExpect(jsonPath("$[?(@.manifest.id=='migraine')].manifest.name").value("Emicrania"))
                .andExpect(jsonPath("$[?(@.manifest.id=='migraine')].manifest.entities[0].key").value("migraine_risk"))
                .andExpect(jsonPath("$[0].result").doesNotExist());
    }

    @Test
    void theMigraineEntityStateIsReadFromTheStoredResult() throws Exception {
        LocalDate today = computation.today();
        // Notte con sonno corto, ieri e oggi: servono almeno 3 condizioni valutabili.
        jdbc.update("INSERT INTO daily_feature (device_id, day, feature, value) VALUES (?, ?, 'sleep_asleep_min', 300)", device, today.toString());
        jdbc.update("INSERT INTO daily_feature (device_id, day, feature, value) VALUES (?, ?, 'stress_high_share', 0.1)", device, today.minusDays(1).toString());
        jdbc.update("INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) VALUES (?, ?, 'sleep_regularity', 'v1', 90, '[]', 0)", device, today.toString());
        plugins.evaluateAll(device);
        var states = plugins.entityStates(device);
        org.assertj.core.api.Assertions.assertThat(states).containsKey("migraine_risk");
        org.assertj.core.api.Assertions.assertThat(states.get("migraine_risk").state()).isEqualTo("low");
        org.assertj.core.api.Assertions.assertThat(states.get("migraine_risk").attributes()).containsEntry("score", 20);

        update("migraine", "{\"enabled\":false}").andExpect(status().isOk());
        org.assertj.core.api.Assertions.assertThat(plugins.entityStates(device)).doesNotContainKey("migraine_risk");
    }

    @Test
    void evaluatingStoresTheCardsAndTheListReturnsThem() throws Exception {
        aWeekOfSleep();
        plugins.evaluateAll(device);
        list().andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].result.cards[0].type").value("score"))
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].result.cards[0].title").value("Sonno"))
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].result.cards[0].value").value(80))
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].result.cards[0].zone").value("buono"));
    }

    @Test
    void everyPluginDeclaresItsCadenceInTheManifest() throws Exception {
        list().andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.manifest.id=='migraine')].manifest.cadence").value("daily"))
                .andExpect(jsonPath("$[?(@.manifest.id=='caffeine-window')].manifest.cadence").value("daily"))
                .andExpect(jsonPath("$[?(@.manifest.id=='vitamin-d')].manifest.cadence").value("daily"))
                .andExpect(jsonPath("$[?(@.manifest.id=='circadian')].manifest.cadence").value("weekly"))
                .andExpect(jsonPath("$[?(@.manifest.id=='social-jetlag')].manifest.cadence").value("weekly"))
                .andExpect(jsonPath("$[?(@.manifest.id=='weekly-report')].manifest.cadence").value("weekly"));
        String body = list().andReturn().getResponse().getContentAsString();
        for (tools.jackson.databind.JsonNode node : new tools.jackson.databind.ObjectMapper().readTree(body)) {
            org.assertj.core.api.Assertions.assertThat(node.get("manifest").get("cadence").asString())
                    .as(node.get("manifest").get("id").asString())
                    .isIn("daily", "weekly");
        }
    }

    @Test
    void theStoredResultCarriesTheHeadlineOrANullOne() throws Exception {
        aWeekOfSleep();
        plugins.evaluateAll(device);
        tools.jackson.databind.JsonNode caffeine = pluginNode("caffeine-window").get("result").get("headline");
        org.assertj.core.api.Assertions.assertThat(caffeine.get("value").asString()).isEqualTo("08:30 – 15:00");
        org.assertj.core.api.Assertions.assertThat(caffeine.has("tone")).isTrue();
        org.assertj.core.api.Assertions.assertThat(caffeine.get("tone").isNull()).isTrue();
        // One week of sleep only: nothing to compare with, so the headline is there and null.
        tools.jackson.databind.JsonNode report = pluginNode("weekly-report").get("result");
        org.assertj.core.api.Assertions.assertThat(report.has("headline")).isTrue();
        org.assertj.core.api.Assertions.assertThat(report.get("headline").isNull()).isTrue();
    }

    @Test
    void turningAPluginOffHidesItsResultAndStopsEvaluatingIt() throws Exception {
        aWeekOfSleep();
        plugins.evaluateAll(device);
        update("weekly-report", "{\"enabled\":false}").andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        tools.jackson.databind.JsonNode report = pluginNode("weekly-report");
        org.assertj.core.api.Assertions.assertThat(report.get("enabled").asBoolean()).isFalse();
        org.assertj.core.api.Assertions.assertThat(report.get("result").isNull()).isTrue();
        jdbc.update("DELETE FROM plugin_result");
        plugins.evaluateAll(device);
        Integer stored = jdbc.queryForObject("SELECT COUNT(*) FROM plugin_result WHERE plugin_id = 'weekly-report'", Integer.class);
        org.assertj.core.api.Assertions.assertThat(stored).isZero();
    }

    @Test
    void turningAPluginOnAgainEvaluatesItRightAway() throws Exception {
        aWeekOfSleep();
        update("weekly-report", "{\"enabled\":false}").andExpect(status().isOk());
        update("weekly-report", "{\"enabled\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.result.cards[0].title").value("Sonno"));
    }

    @Test
    void anUnknownPluginIs404AndABadConfigIs400() throws Exception {
        update("nope", "{\"enabled\":true}").andExpect(status().isNotFound());
        update("weekly-report", "{\"config\":{\"unknown\":1}}").andExpect(status().isBadRequest());
    }

    @Test
    void aDayThatIsNotADateIs400() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/plugins?day=ieri").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anotherDevicesTokenCannotReadOrChangeThePlugins() throws Exception {
        String other = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", other, "synthetic-" + other);
        String otherToken = tokens.issue(other);
        mvc.perform(get("/api/v1/devices/" + device + "/plugins").header("Authorization", "Bearer " + otherToken))
                .andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/devices/" + device + "/plugins/weekly-report")
                        .header("Authorization", "Bearer " + otherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":false}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void withoutATokenItIsRefused() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/plugins")).andExpect(status().isUnauthorized());
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-plugins");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
