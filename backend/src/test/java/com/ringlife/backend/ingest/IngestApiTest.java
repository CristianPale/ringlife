package com.ringlife.backend.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterAll;
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

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Ingest idempotente e autenticazione (ADR 0008). Tutti i dati sono sintetici: nessun MAC, nessun valore reale.
 */
@SpringBootTest
@AutoConfigureMockMvc
class IngestApiTest {

    private static final Path DB_DIR = createTempDir();
    private static final String SECRET = "test-pairing-secret";
    private static final long T0 = Instant.parse("2026-11-02T00:00:00Z").toEpochMilli();
    private static final long MIN = 60_000L;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("ingest.sqlite").toString());
        registry.add("ringlife.pairing-secret", () -> SECRET);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    private final ObjectMapper json = new ObjectMapper();

    private String deviceId;
    private String token;

    @BeforeEach
    void registerDevice() throws Exception {
        jdbc.update("DELETE FROM sleep_stage");
        jdbc.update("DELETE FROM sleep_session");
        jdbc.update("DELETE FROM sample");
        jdbc.update("DELETE FROM sync_log");
        JsonNode body = register("synthetic-ring-1");
        deviceId = body.get("deviceId").asText();
        token = body.get("token").asText();
    }

    // --- registrazione ---

    @Test
    void registrationNeedsTheSecret() throws Exception {
        mvc.perform(post("/api/v1/devices").contentType(MediaType.APPLICATION_JSON).content(registration("x")))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", "wrong")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registration("x")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void registrationRejectsMissingFields() throws Exception {
        mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", SECRET)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"model\":\"test\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", SECRET)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("non json"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void registeringTheSameHardwareRotatesTheToken() throws Exception {
        JsonNode second = register("synthetic-ring-1");
        assertThat(second.get("deviceId").asText()).isEqualTo(deviceId);
        assertThat(second.get("token").asText()).isNotEqualTo(token);

        postSamples(deviceId, token, samples(sample("HR", T0, 60))).andExpect(status().isUnauthorized());
        postSamples(deviceId, second.get("token").asText(), samples(sample("HR", T0, 60))).andExpect(status().isOk());
        token = second.get("token").asText();
    }

    @Test
    void theTokenIsStoredOnlyAsAHash() {
        Integer plain = jdbc.queryForObject("SELECT COUNT(*) FROM api_token WHERE token_hash = ?", Integer.class, token);
        assertThat(plain).isZero();
        String hash = jdbc.queryForObject(
                "SELECT token_hash FROM api_token WHERE device_id = ? AND revoked_at IS NULL", String.class, deviceId);
        assertThat(hash).hasSize(64).matches("[0-9a-f]+");
    }

    // --- autenticazione ---

    @Test
    void uploadsNeedAValidToken() throws Exception {
        String body = samples(sample("HR", T0, 60));
        mvc.perform(post("/api/v1/devices/" + deviceId + "/samples")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        postSamples(deviceId, "not-a-token", body).andExpect(status().isUnauthorized());
        postSamples(deviceId, token, body).andExpect(status().isOk());
    }

    @Test
    void aTokenOnlyWorksForItsOwnDevice() throws Exception {
        JsonNode other = register("synthetic-ring-2");
        String otherId = other.get("deviceId").asText();
        postSamples(otherId, token, samples(sample("HR", T0, 60))).andExpect(status().isUnauthorized());
        assertThat(count("sample")).isZero();
    }

    // --- campioni ---

    @Test
    void newSamplesAreInserted() throws Exception {
        postSamples(deviceId, token, samples(sample("HR", T0, 61), sample("HR", T0 + 5 * MIN, 62), sample("STEPS", T0, 10)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received").value(3))
                .andExpect(jsonPath("$.inserted").value(3))
                .andExpect(jsonPath("$.duplicates").value(0));
        assertThat(count("sample")).isEqualTo(3);
    }

    @Test
    void repeatingTheSameUploadChangesNothing() throws Exception {
        String body = samples(sample("HR", T0, 61), sample("SPO2", T0, 97));
        postSamples(deviceId, token, body).andExpect(jsonPath("$.inserted").value(2));
        postSamples(deviceId, token, body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inserted").value(0))
                .andExpect(jsonPath("$.duplicates").value(2));
        assertThat(count("sample")).isEqualTo(2);
    }

    @Test
    void aPartiallyOverlappingUploadAddsOnlyTheNewOnes() throws Exception {
        postSamples(deviceId, token, samples(sample("HR", T0, 61), sample("HR", T0 + 5 * MIN, 62)));
        postSamples(deviceId, token, samples(sample("HR", T0 + 5 * MIN, 62), sample("HR", T0 + 10 * MIN, 63)))
                .andExpect(jsonPath("$.inserted").value(1))
                .andExpect(jsonPath("$.duplicates").value(1));
        assertThat(count("sample")).isEqualTo(3);
    }

    @Test
    void anExistingSampleIsNeverOverwritten() throws Exception {
        postSamples(deviceId, token, samples(sample("HR", T0, 61)));
        postSamples(deviceId, token, samples(sample("HR", T0, 99)));
        Double value = jdbc.queryForObject("SELECT value FROM sample WHERE device_id = ?", Double.class, deviceId);
        assertThat(value).isEqualTo(61.0);
    }

    @Test
    void oneInvalidSampleRejectsTheWholeRequest() throws Exception {
        postSamples(deviceId, token, samples(sample("HR", T0, 61), sample("BLOOD_PRESSURE", T0, 120)))
                .andExpect(status().isBadRequest());
        assertThat(count("sample")).isZero();
    }

    @Test
    void timestampsMustBePlausible() throws Exception {
        postSamples(deviceId, token, samples(sample("HR", Instant.parse("2019-12-31T00:00:00Z").toEpochMilli(), 60)))
                .andExpect(status().isBadRequest());
        postSamples(deviceId, token, samples(sample("HR", Instant.now().plusSeconds(3 * 86400).toEpochMilli(), 60)))
                .andExpect(status().isBadRequest());
        assertThat(count("sample")).isZero();
    }

    @Test
    void theOffsetIsRequiredAndLimited() throws Exception {
        postSamples(deviceId, token, "{\"samples\":[]}").andExpect(status().isBadRequest());
        postSamples(deviceId, token, "{\"tzOffsetMin\":2000,\"samples\":[]}").andExpect(status().isBadRequest());
    }

    @Test
    void aBatchIsLimited() throws Exception {
        String many = IntStream.range(0, IngestValidator.MAX_SAMPLES + 1)
                .mapToObj(i -> sample("HR", T0 + i * MIN, 60))
                .collect(Collectors.joining(","));
        postSamples(deviceId, token, "{\"tzOffsetMin\":60,\"samples\":[" + many + "]}")
                .andExpect(status().isBadRequest());
        assertThat(count("sample")).isZero();
    }

    @Test
    void eachUploadIsLoggedWithItsOffsetAndUpdatesTheDevice() throws Exception {
        postSamples(deviceId, token, "{\"tzOffsetMin\":120,\"samples\":[" + sample("HR", T0, 60) + "]}");
        postSamples(deviceId, token, "{\"tzOffsetMin\":120,\"samples\":[" + sample("HR", T0, 60) + "]}");
        List<Integer> offsets = jdbc.queryForList("SELECT tz_offset_min FROM sync_log WHERE device_id = ?", Integer.class, deviceId);
        assertThat(offsets).containsExactly(120, 120);
        List<Integer> inserted =
                jdbc.queryForList("SELECT inserted_count FROM sync_log WHERE device_id = ? ORDER BY received_at, rowid", Integer.class, deviceId);
        assertThat(inserted).containsExactly(1, 0);
        Long last = jdbc.queryForObject("SELECT last_sync_at FROM device WHERE id = ?", Long.class, deviceId);
        assertThat(last).isNotNull().isGreaterThan(0);
    }

    @Test
    void errorMessagesDoNotEchoTheValuesReceived() throws Exception {
        String response = postSamples(deviceId, token, samples(sample("SECRET_METRIC_NAME", T0, 60)))
                .andExpect(status().isBadRequest())
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(response).doesNotContain("SECRET_METRIC_NAME");
    }

    // --- sonno ---

    @Test
    void aSleepSessionIsStoredWithItsStages() throws Exception {
        postSleep(deviceId, token, sleep(session(T0, T0 + 480 * MIN, stage("light", T0, T0 + 120 * MIN), stage("deep", T0 + 120 * MIN, T0 + 200 * MIN))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inserted").value(1));
        assertThat(count("sleep_session")).isEqualTo(1);
        assertThat(count("sleep_stage")).isEqualTo(2);
    }

    @Test
    void repeatingASleepSessionDoesNotDuplicateItOrItsStages() throws Exception {
        String body = sleep(session(T0, T0 + 480 * MIN, stage("light", T0, T0 + 120 * MIN)));
        postSleep(deviceId, token, body);
        postSleep(deviceId, token, body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inserted").value(0))
                .andExpect(jsonPath("$.duplicates").value(1));
        assertThat(count("sleep_session")).isEqualTo(1);
        assertThat(count("sleep_stage")).isEqualTo(1);
    }

    @Test
    void aNightReadWhileStillGoingIsReplacedByTheLongerOne() throws Exception {
        // Lettura in background alle 2 di notte: la sessione finisce dove era arrivato l'anello.
        postSleep(deviceId, token, sleep(session(T0, T0 + 110 * MIN, stage("light", T0, T0 + 110 * MIN))));
        // Lettura del mattino: stesso inizio, la notte intera.
        postSleep(deviceId, token, sleep(session(
                        T0, T0 + 480 * MIN,
                        stage("light", T0, T0 + 120 * MIN), stage("deep", T0 + 120 * MIN, T0 + 200 * MIN), stage("rem", T0 + 200 * MIN, T0 + 480 * MIN))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inserted").value(1));
        assertThat(count("sleep_session")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT end_ts FROM sleep_session", Long.class)).isEqualTo(T0 + 480 * MIN);
        assertThat(jdbc.queryForList("SELECT stage FROM sleep_stage ORDER BY start_ts", String.class))
                .containsExactly("light", "deep", "rem");
    }

    @Test
    void aShorterCopyOfANightNeverReplacesTheLongerOne() throws Exception {
        postSleep(deviceId, token, sleep(session(T0, T0 + 480 * MIN, stage("light", T0, T0 + 120 * MIN), stage("deep", T0 + 120 * MIN, T0 + 480 * MIN))));
        postSleep(deviceId, token, sleep(session(T0, T0 + 110 * MIN, stage("light", T0, T0 + 110 * MIN))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inserted").value(0))
                .andExpect(jsonPath("$.duplicates").value(1));
        assertThat(jdbc.queryForObject("SELECT end_ts FROM sleep_session", Long.class)).isEqualTo(T0 + 480 * MIN);
        assertThat(count("sleep_stage")).isEqualTo(2);
    }

    @Test
    void sleepStagesMustBeConsistent() throws Exception {
        long end = T0 + 480 * MIN;
        // sovrapposte
        postSleep(deviceId, token, sleep(session(T0, end, stage("light", T0, T0 + 100 * MIN), stage("deep", T0 + 90 * MIN, T0 + 150 * MIN))))
                .andExpect(status().isBadRequest());
        // fuori dalla sessione
        postSleep(deviceId, token, sleep(session(T0, end, stage("light", T0 - MIN, T0 + 10 * MIN))))
                .andExpect(status().isBadRequest());
        // fase sconosciuta
        postSleep(deviceId, token, sleep(session(T0, end, stage("dreaming", T0, T0 + 10 * MIN))))
                .andExpect(status().isBadRequest());
        // fine prima dell'inizio
        postSleep(deviceId, token, sleep(session(end, T0)))
                .andExpect(status().isBadRequest());
        assertThat(count("sleep_session")).isZero();
    }

    @Test
    void aSleepSessionCannotLastMoreThanADay() throws Exception {
        postSleep(deviceId, token, sleep(session(T0, T0 + 25 * 60 * MIN))).andExpect(status().isBadRequest());
    }

    @Test
    void stagesMayHaveGapsAndArriveOutOfOrder() throws Exception {
        postSleep(deviceId, token, sleep(session(T0, T0 + 480 * MIN, stage("deep", T0 + 200 * MIN, T0 + 260 * MIN), stage("light", T0, T0 + 100 * MIN))))
                .andExpect(status().isOk());
        assertThat(count("sleep_stage")).isEqualTo(2);
    }

    // --- aiuti ---

    private JsonNode register(String hardwareId) throws Exception {
        String content = mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", SECRET)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registration(hardwareId)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return json.readTree(content);
    }

    private static String registration(String hardwareId) {
        return "{\"hardwareId\":\"" + hardwareId + "\",\"model\":\"synthetic\",\"firmware\":\"0.0\"}";
    }

    private ResultActions postSamples(String device, String bearer, String body) throws Exception {
        return mvc.perform(post("/api/v1/devices/" + device + "/samples")
                .header("Authorization", "Bearer " + bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions postSleep(String device, String bearer, String body) throws Exception {
        return mvc.perform(post("/api/v1/devices/" + device + "/sleep")
                .header("Authorization", "Bearer " + bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private static String sample(String metric, long ts, double value) {
        return "{\"metric\":\"" + metric + "\",\"ts\":" + ts + ",\"value\":" + value + "}";
    }

    private static String samples(String... items) {
        return "{\"tzOffsetMin\":60,\"samples\":[" + String.join(",", items) + "]}";
    }

    private static String stage(String stage, long start, long end) {
        return "{\"stage\":\"" + stage + "\",\"start\":" + start + ",\"end\":" + end + "}";
    }

    private static String session(long start, long end, String... stages) {
        return "{\"start\":" + start + ",\"end\":" + end + ",\"stages\":[" + String.join(",", stages) + "]}";
    }

    private static String sleep(String... sessions) {
        return "{\"tzOffsetMin\":60,\"sessions\":[" + String.join(",", sessions) + "]}";
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-ingest-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @AfterAll
    static void cleanUp() throws IOException {
        try (var paths = Files.walk(DB_DIR)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        }
    }
}
