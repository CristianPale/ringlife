package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
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
import org.springframework.test.web.servlet.MvcResult;

import com.ringlife.backend.device.TokenService;

/** Il report per il medico (ADR 0019) con un database vero: dal diario al PDF, su dati sintetici. */
@SpringBootTest
@AutoConfigureMockMvc
class MigraineReportApiTest {

    private static final Path DB_DIR = createTempDir();
    private static final String SECRET_NOTE = "nota-privata-da-non-esportare";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("report.sqlite").toString());
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
    void freshDevice() throws Exception {
        jdbc.update("DELETE FROM plugin_result");
        jdbc.update("DELETE FROM plugin_state");
        jdbc.update("DELETE FROM headache_episode");
        jdbc.update("DELETE FROM journal_entry");
        jdbc.update("DELETE FROM api_token");
        jdbc.update("DELETE FROM device");
        device = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", device, "synthetic-" + device);
        token = tokens.issue(device);
    }

    private static long daysAgo(int days, int hour) {
        return Instant.now().minus(Duration.ofDays(days)).truncatedTo(java.time.temporal.ChronoUnit.DAYS).plus(Duration.ofHours(hour)).toEpochMilli();
    }

    private void diary(String episodes) throws Exception {
        mvc.perform(put("/api/v1/devices/" + device + "/diary")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"entries\":[],\"episodes\":[" + episodes + "],\"deletedEntries\":[],\"deletedEpisodes\":[]}"))
                .andExpect(status().isOk());
    }

    private static String episode(String id, long start, Long end, int intensity, int medications) {
        StringBuilder meds = new StringBuilder();
        for (int i = 0; i < medications; i++) {
            meds.append(i == 0 ? "" : ",").append(start + 600_000L * (i + 1));
        }
        return "{\"id\":\"" + id + "\",\"start\":" + start + ",\"end\":" + (end == null ? "null" : end) + ",\"intensity\":" + intensity
                + ",\"intensityLog\":[{\"at\":" + start + ",\"value\":" + intensity + "}],\"medicationAt\":[" + meds + "],"
                + "\"details\":{\"symptoms\":[\"nausea\",\"photophobia\"],\"location\":\"left\",\"medicationHelp\":\"a_lot\","
                + "\"causes\":[\"stress\"],\"notes\":\"" + SECRET_NOTE + "\"},\"completedAt\":null}";
    }

    private MvcResult pdf(int days) throws Exception {
        return mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine?days=" + days)
                        .header("Authorization", "Bearer " + token)
                        .accept(MediaType.APPLICATION_PDF))
                .andExpect(status().isOk())
                .andReturn();
    }

    private static String text(byte[] pdf) throws IOException {
        try (PDDocument document = Loader.loadPDF(pdf)) {
            return new PDFTextStripper().getText(document).replaceAll("\\s+", " ");
        }
    }

    @Test
    void theSummaryHasTheNumbersAndTheDetailsButNeverTheNotes() throws Exception {
        diary(episode("h1", daysAgo(10, 7), daysAgo(10, 9), 6, 2) + "," + episode("h2", daysAgo(3, 7), null, 8, 0));
        MvcResult result = mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary?days=90")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.days").value(90))
                .andExpect(jsonPath("$.summary.episodes").value(2))
                .andExpect(jsonPath("$.summary.peakMax").value(8))
                .andExpect(jsonPath("$.summary.medicationIntakes").value(2))
                .andExpect(jsonPath("$.episodes.length()").value(2))
                .andExpect(jsonPath("$.episodes[0].location").value("left"))
                .andExpect(jsonPath("$.episodes[0].symptoms[0]").value("nausea"))
                .andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain(SECRET_NOTE);
    }

    @Test
    void thePdfIsAPdfWithTheEpisodesAndWithoutTheNotes() throws Exception {
        diary(episode("h1", daysAgo(10, 7), daysAgo(10, 9), 6, 2));
        MvcResult result = pdf(90);
        assertThat(result.getResponse().getContentType()).isEqualTo("application/pdf");
        assertThat(result.getResponse().getHeader("Content-Disposition")).contains("report-cefalee-").contains(".pdf");
        assertThat(result.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        String text = text(result.getResponse().getContentAsByteArray());
        assertThat(text).contains("Report delle cefalee").contains("Cefalee: 1 (1 giorno con cefalea).").contains("nausea, fotofobia").contains("sinistra");
        assertThat(text).doesNotContain(SECRET_NOTE);
    }

    @Test
    void anEmptyDiaryStillGivesAShortReport() throws Exception {
        String text = text(pdf(30).getResponse().getContentAsByteArray());
        assertThat(text).contains("Nessuna cefalea registrata nel periodo.");
    }

    @Test
    void onlyTheEpisodesInsideThePeriodCount() throws Exception {
        diary(episode("old", daysAgo(100, 7), daysAgo(100, 8), 5, 0) + "," + episode("new", daysAgo(5, 7), daysAgo(5, 8), 5, 0));
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary?days=90").header("Authorization", "Bearer " + token))
                .andExpect(jsonPath("$.summary.episodes").value(1));
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary?days=180").header("Authorization", "Bearer " + token))
                .andExpect(jsonPath("$.summary.episodes").value(2));
    }

    @Test
    void refusesAPeriodThatIsNotOffered() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary?days=45").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine?days=0").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
    }

    @Test
    void needsTheDeviceToken() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine").header("Authorization", "Bearer wrong"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anotherDeviceTokenDoesNotOpenThisReport() throws Exception {
        String other = java.util.UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", other, "synthetic-" + other);
        String otherToken = tokens.issue(other);
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine").header("Authorization", "Bearer " + otherToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void theDefaultPeriodIsNinetyDays() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/reports/migraine/summary").header("Authorization", "Bearer " + token))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.days").value(90));
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
