package com.ringlife.backend.ha;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Il percorso intero: un caricamento fa partire il calcolo e il calcolo pubblica le entita' sul broker (ADR 0011).
 * Dati sintetici, broker in memoria.
 */
@SpringBootTest
@AutoConfigureMockMvc
class HaMqttIntegrationTest {

    private static final Path DB_DIR = createTempDir();
    private static final String SECRET = "test-pairing-secret";
    private static final EmbeddedBroker BROKER = new EmbeddedBroker();
    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final long MIN = 60_000L;

    static {
        try {
            BROKER.start();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("ha.sqlite").toString());
        registry.add("ringlife.pairing-secret", () -> SECRET);
        registry.add("ringlife.mqtt.host", () -> "127.0.0.1");
        registry.add("ringlife.mqtt.port", () -> String.valueOf(BROKER.port()));
    }

    @AfterAll
    static void stopBroker() throws Exception {
        BROKER.close();
    }

    @Autowired
    MockMvc mvc;

    private final ObjectMapper json = new ObjectMapper();

    private static long at(LocalDate day, int hour, int minute) {
        return day.atStartOfDay(ROME).plusHours(hour).plusMinutes(minute).toInstant().toEpochMilli();
    }

    @Test
    void anUploadPublishesTheEntitiesToTheBroker() throws Exception {
        String content = mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", SECRET)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hardwareId\":\"synthetic-ha-1\",\"model\":\"synthetic\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode registration = json.readTree(content);
        String device = registration.get("deviceId").asText();
        String token = registration.get("token").asText();

        // Una notte finita ieri e una giornata di passi: abbastanza per un indice Sonno e i passi di oggi.
        LocalDate today = LocalDate.now(ROME);
        long start = at(today.minusDays(1), 23, 30);
        long end = at(today, 7, 0);
        if (end > Instant.now().toEpochMilli()) {
            // Prima delle 7 la notte non e' ancora finita: la si sposta di un giorno indietro.
            start = at(today.minusDays(2), 23, 30);
            end = at(today.minusDays(1), 7, 0);
        }
        List<String> stages = new ArrayList<>();
        long cursor = start;
        for (int[] part : new int[][] {{0, 10}, {1, 120}, {2, 70}, {1, 60}, {3, 50}, {1, 140}}) {
            String stage = new String[] {"awake", "light", "deep", "rem"}[part[0]];
            stages.add("{\"stage\":\"" + stage + "\",\"start\":" + cursor + ",\"end\":" + (cursor + part[1] * MIN) + "}");
            cursor += part[1] * MIN;
        }
        upload(device, token, "sleep", "{\"tzOffsetMin\":60,\"sessions\":[{\"start\":" + start + ",\"end\":" + cursor
                + ",\"stages\":[" + String.join(",", stages) + "]}]}");

        assertThat(EmbeddedBroker.waitFor(() -> BROKER.messages.containsKey("ringlife/sleep_index/state"))).isTrue();
        assertThat(BROKER.messages.get("ringlife/availability")).isEqualTo("online");
        assertThat(BROKER.messages.get("ringlife/sleep_index/state")).matches("\\d+");
        JsonNode config = json.readTree(BROKER.messages.get("homeassistant/sensor/ringlife/sleep_index/config"));
        assertThat(config.get("unique_id").asText()).isEqualTo("ringlife_sleep_index");
        JsonNode attributes = json.readTree(BROKER.messages.get("ringlife/sleep_index/attributes"));
        assertThat(attributes.get("algo_version").asText()).isEqualTo("v1");
        assertThat(attributes.get("components").isArray()).isTrue();
        assertThat(BROKER.messages.get("ringlife/sleep_start/state")).isEqualTo(Instant.ofEpochMilli(start).toString());
        assertThat(BROKER.messages.get("ringlife/last_sync/state")).endsWith("Z");
        // Quello che non c'e' resta sconosciuto, non inventato.
        assertThat(BROKER.messages.get("ringlife/stress_rhythm/state")).isEqualTo("None");
        assertThat(BROKER.messages.get("ringlife/steps_today/state")).isEqualTo("None");
    }

    private void upload(String device, String token, String path, String body) throws Exception {
        mvc.perform(post("/api/v1/devices/" + device + "/" + path)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-ha-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
