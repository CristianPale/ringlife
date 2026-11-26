package com.ringlife.backend.diary;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

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

import com.ringlife.backend.device.TokenService;

/** Sync del diario (ADR 0010). Dati sintetici: nessun valore reale. */
@SpringBootTest
@AutoConfigureMockMvc
class DiaryApiTest {

    private static final Path DB_DIR = createTempDir();
    private static final long T0 = Instant.parse("2026-11-02T08:00:00Z").toEpochMilli();
    private static final long MIN = 60_000L;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("diary.sqlite").toString());
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TokenService tokens;

    private String device;
    private String token;

    @BeforeEach
    void freshDevice() {
        jdbc.update("DELETE FROM journal_entry");
        jdbc.update("DELETE FROM headache_episode");
        jdbc.update("DELETE FROM plugin_result");
        jdbc.update("DELETE FROM plugin_state");
        jdbc.update("DELETE FROM api_token");
        jdbc.update("DELETE FROM device");
        device = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", device, "synthetic-" + device);
        token = tokens.issue(device);
    }

    // --- aiuti ---

    private ResultActions send(String body) throws Exception {
        return send(device, token, body);
    }

    private ResultActions send(String deviceId, String bearer, String body) throws Exception {
        return mvc.perform(put("/api/v1/devices/" + deviceId + "/diary")
                .header("Authorization", "Bearer " + bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private static String coffee(String id, long ts) {
        return "{\"id\":\"" + id + "\",\"ts\":" + ts + ",\"kind\":\"caffeine\",\"drink\":\"coffee\"}";
    }

    private static String note(String id, long ts, String text) {
        return "{\"id\":\"" + id + "\",\"ts\":" + ts + ",\"kind\":\"note\",\"text\":\"" + text + "\"}";
    }

    private static String episode(String id, long start, String end, int intensity) {
        return "{\"id\":\"" + id + "\",\"start\":" + start + ",\"end\":" + end + ",\"intensity\":" + intensity
                + ",\"intensityLog\":[{\"at\":" + start + ",\"value\":" + intensity + "}],\"medicationAt\":[],"
                + "\"details\":{\"symptoms\":[\"nausea\"],\"location\":\"left\",\"medicationHelp\":null,"
                + "\"causes\":[\"stress\"],\"notes\":\"\"},\"completedAt\":null}";
    }

    private static String body(String entries, String episodes, String deletedEntries, String deletedEpisodes) {
        return "{\"entries\":[" + entries + "],\"episodes\":[" + episodes + "],\"deletedEntries\":[" + deletedEntries
                + "],\"deletedEpisodes\":[" + deletedEpisodes + "]}";
    }

    private int count(String table) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
        return n == null ? 0 : n;
    }

    // --- scrittura ---

    @Test
    void storesEntriesAndEpisodes() throws Exception {
        send(body(coffee("e1", T0) + "," + note("e2", T0 + MIN, "poco sonno"), episode("h1", T0, "null", 6), "", ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.upserted").value(2))
                .andExpect(jsonPath("$.episodes.upserted").value(1))
                .andExpect(jsonPath("$.entries.deleted").value(0));
        assertThat(count("journal_entry")).isEqualTo(2);
        assertThat(count("headache_episode")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT payload FROM journal_entry WHERE id = 'e1'", String.class))
                .contains("coffee");
        assertThat(jdbc.queryForObject("SELECT payload FROM journal_entry WHERE id = 'e2'", String.class))
                .contains("poco sonno");
    }

    @Test
    void repeatingTheSameRequestChangesNothing() throws Exception {
        String request = body(coffee("e1", T0), episode("h1", T0, "null", 6), "", "");
        send(request).andExpect(status().isOk());
        send(request).andExpect(status().isOk());
        assertThat(count("journal_entry")).isEqualTo(1);
        assertThat(count("headache_episode")).isEqualTo(1);
    }

    @Test
    void anEpisodeIsReplacedByItsLatestState() throws Exception {
        send(body("", episode("h1", T0, "null", 6), "", "")).andExpect(status().isOk());
        send(body("", episode("h1", T0, String.valueOf(T0 + 90 * MIN), 4), "", "")).andExpect(status().isOk());
        assertThat(count("headache_episode")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT intensity FROM headache_episode WHERE id = 'h1'", Integer.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT end_ts FROM headache_episode WHERE id = 'h1'", Long.class)).isEqualTo(T0 + 90 * MIN);
    }

    @Test
    void deletesWhatThePhoneRemoved() throws Exception {
        send(body(coffee("e1", T0) + "," + coffee("e2", T0 + MIN), episode("h1", T0, "null", 6), "", ""))
                .andExpect(status().isOk());
        send(body("", "", "\"e1\",\"missing\"", "\"h1\""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.deleted").value(1))
                .andExpect(jsonPath("$.episodes.deleted").value(1));
        assertThat(count("journal_entry")).isEqualTo(1);
        assertThat(count("headache_episode")).isZero();
    }

    @Test
    void anEmptyRequestIsFine() throws Exception {
        send("{}").andExpect(status().isOk()).andExpect(jsonPath("$.entries.upserted").value(0));
    }

    // --- lettura ---

    @Test
    void readsBackWhatWasSent() throws Exception {
        send(body(coffee("e1", T0) + "," + note("e2", T0 + MIN, "poco sonno"),
                episode("h1", T0, "null", 6) + "," + episode("h2", T0 + 10 * MIN, String.valueOf(T0 + 90 * MIN), 4), "", ""))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/devices/" + device + "/diary").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.entries[0].id").value("e1"))
                .andExpect(jsonPath("$.entries[0].kind").value("caffeine"))
                .andExpect(jsonPath("$.entries[0].drink").value("coffee"))
                .andExpect(jsonPath("$.entries[0].text").doesNotExist())
                .andExpect(jsonPath("$.entries[1].text").value("poco sonno"))
                .andExpect(jsonPath("$.episodes.length()").value(2))
                .andExpect(jsonPath("$.episodes[0].id").value("h1"))
                .andExpect(jsonPath("$.episodes[0].end").doesNotExist())
                .andExpect(jsonPath("$.episodes[0].intensity").value(6))
                .andExpect(jsonPath("$.episodes[0].intensityLog[0].value").value(6))
                .andExpect(jsonPath("$.episodes[0].details.symptoms[0]").value("nausea"))
                .andExpect(jsonPath("$.episodes[0].details.location").value("left"))
                .andExpect(jsonPath("$.episodes[0].completedAt").doesNotExist())
                .andExpect(jsonPath("$.episodes[1].end").value(T0 + 90 * MIN));
    }

    @Test
    void anEmptyDiaryReadsAsEmptyLists() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/diary").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(0))
                .andExpect(jsonPath("$.episodes.length()").value(0));
    }

    @Test
    void readsOnlyTheRowsOfItsOwnDevice() throws Exception {
        send(body(coffee("e1", T0), "", "", "")).andExpect(status().isOk());
        String other = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", other, "synthetic-" + other);
        mvc.perform(get("/api/v1/devices/" + other + "/diary").header("Authorization", "Bearer " + tokens.issue(other)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(0));
        mvc.perform(get("/api/v1/devices/" + device + "/diary")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices/" + other + "/diary").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    // --- autenticazione e separazione ---

    @Test
    void needsTheDeviceToken() throws Exception {
        mvc.perform(put("/api/v1/devices/" + device + "/diary").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        send(device, "not-a-token", "{}").andExpect(status().isUnauthorized());
    }

    @Test
    void aDeviceCannotTouchTheRowsOfAnother() throws Exception {
        send(body(coffee("shared", T0), "", "", "")).andExpect(status().isOk());

        String other = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", other, "synthetic-" + other);
        String otherToken = tokens.issue(other);
        // Stesso id, altro dispositivo: crea una riga sua e non tocca quella del primo.
        send(other, otherToken, body(note("shared", T0, "altro"), "", "", "")).andExpect(status().isOk());
        send(other, otherToken, body("", "", "\"shared\"", "")).andExpect(status().isOk());

        assertThat(count("journal_entry")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT kind FROM journal_entry WHERE device_id = ?", String.class, device))
                .isEqualTo("caffeine");
        send(device, otherToken, "{}").andExpect(status().isUnauthorized());
    }

    // --- validazione: un elemento non valido rifiuta tutto, senza scrivere niente ---

    @Test
    void rejectsInvalidEntries() throws Exception {
        String good = coffee("ok", T0);
        for (String bad : new String[] {
            "{\"id\":\"b\",\"ts\":" + T0 + ",\"kind\":\"sport\"}",
            "{\"id\":\"b\",\"ts\":" + T0 + ",\"kind\":\"caffeine\",\"drink\":\"wine\"}",
            "{\"id\":\"b\",\"ts\":" + T0 + ",\"kind\":\"alcohol\"}",
            "{\"id\":\"b\",\"ts\":" + T0 + ",\"kind\":\"note\",\"text\":\"  \"}",
            "{\"id\":\"b\",\"ts\":" + T0 + ",\"kind\":\"note\",\"text\":\"" + "x".repeat(1001) + "\"}",
            "{\"id\":\"bad id!\",\"ts\":" + T0 + ",\"kind\":\"caffeine\",\"drink\":\"tea\"}",
            "{\"id\":\"\",\"ts\":" + T0 + ",\"kind\":\"caffeine\",\"drink\":\"tea\"}",
            "{\"id\":\"b\",\"ts\":1000,\"kind\":\"caffeine\",\"drink\":\"tea\"}",
            "{\"id\":\"b\",\"ts\":" + Instant.parse("2099-01-01T00:00:00Z").toEpochMilli() + ",\"kind\":\"caffeine\",\"drink\":\"tea\"}",
        }) {
            send(body(good + "," + bad, "", "", "")).andExpect(status().isBadRequest());
        }
        assertThat(count("journal_entry")).isZero();
    }

    @Test
    void rejectsInvalidEpisodes() throws Exception {
        String good = episode("ok", T0, "null", 5);
        for (String bad : new String[] {
            episode("b", T0, "null", 0),
            episode("b", T0, "null", 11),
            episode("b", T0, String.valueOf(T0 - MIN), 5),
            episode("b", 1000, "null", 5),
            episode("b", T0, "null", 5).replace("nausea", "dolore"),
            episode("b", T0, "null", 5).replace("\"left\"", "\"top\""),
            episode("b", T0, "null", 5).replace("stress", "luna"),
            episode("b", T0, "null", 5).replace("\"medicationHelp\":null", "\"medicationHelp\":\"boh\""),
            episode("b", T0, "null", 5).replace("\"notes\":\"\"", "\"notes\":\"" + "x".repeat(1001) + "\""),
            episode("b", T0, "null", 5).replace("\"value\":5", "\"value\":12"),
        }) {
            send(body("", good + "," + bad, "", "")).andExpect(status().isBadRequest());
        }
        assertThat(count("headache_episode")).isZero();
    }

    @Test
    void rejectsRepeatedIdsInTheSameRequest() throws Exception {
        send(body(coffee("e1", T0) + "," + coffee("e1", T0 + MIN), "", "", "")).andExpect(status().isBadRequest());
        send(body(coffee("e1", T0), "", "\"e1\"", "")).andExpect(status().isBadRequest());
        send(body("", episode("h1", T0, "null", 5), "", "\"h1\"")).andExpect(status().isBadRequest());
        assertThat(count("journal_entry")).isZero();
    }

    @Test
    void rejectsTooManyItems() throws Exception {
        String many = IntStream.range(0, 501).mapToObj(i -> coffee("e" + i, T0 + i)).collect(Collectors.joining(","));
        send(body(many, "", "", "")).andExpect(status().isBadRequest());
        assertThat(count("journal_entry")).isZero();
    }

    @Test
    void rejectsBrokenJson() throws Exception {
        send("non json").andExpect(status().isBadRequest());
    }

    @Test
    void errorMessagesDoNotRepeatWhatWasSent() throws Exception {
        send(body(note("n", T0, "  "), "", "", ""))
                .andExpect(status().isBadRequest())
                .andExpect(result -> assertThat(result.getResponse().getContentAsString()).doesNotContain("n\""));
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-diary-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
