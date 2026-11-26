package com.ringlife.backend.compute;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.ringlife.backend.device.TokenService;

/**
 * Calcolo giornaliero e lettura (ADR 0009) su dati sintetici: nessun valore reale. "Oggi" e' fisso al 14 novembre
 * 2026, 12:00 a Roma: i giorni dal 1 al 13 sono completi, il 14 e' in corso.
 */
@SpringBootTest
@AutoConfigureMockMvc
class DailyComputationTest {

    private static final Path DB_DIR = createTempDir();
    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final LocalDate FIRST = LocalDate.of(2026, 11, 1);
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);
    private static final long MIN = 60_000L;

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
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("daily.sqlite").toString());
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    DailyComputationService service;

    @Autowired
    TokenService tokens;

    @Autowired
    MockMvc mvc;

    private String device;

    @BeforeEach
    void freshDevice() {
        for (String table : List.of("daily_metric", "daily_score", "baseline", "daily_feature", "sleep_stage", "sleep_session", "sample")) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("DELETE FROM plugin_result");
        jdbc.update("DELETE FROM plugin_state");
        jdbc.update("DELETE FROM api_token");
        jdbc.update("DELETE FROM device");
        device = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO device (id, mac, model) VALUES (?, ?, 'synthetic')", device, "synthetic-" + device);
    }

    // --- dati sintetici ---

    private static long ms(LocalDate day, int hour, int minute) {
        return day.atStartOfDay(ROME).plusHours(hour).plusMinutes(minute).toInstant().toEpochMilli();
    }

    /** Una notte stabile: a letto alle 23:30, in piedi alle 07:00, 435 minuti di sonno, un risveglio. */
    private void night(LocalDate wakeDay, double hr, double hrv, double temp, double spo2) {
        long start = ms(wakeDay.minusDays(1), 23, 30);
        long end = ms(wakeDay, 7, 0);
        String session = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?)", session, device, start, end);
        stage(session, "awake", start, 10);
        stage(session, "light", start + 10 * MIN, 120);
        stage(session, "deep", start + 130 * MIN, 70);
        stage(session, "light", start + 200 * MIN, 60);
        stage(session, "rem", start + 260 * MIN, 50);
        stage(session, "light", start + 310 * MIN, 60);
        stage(session, "awake", start + 370 * MIN, 5);
        stage(session, "rem", start + 375 * MIN, 45);
        stage(session, "light", start + 420 * MIN, 30);
        for (long t = start; t < end; t += 5 * MIN) {
            sample("HR", t, hr);
        }
        for (long t = start; t < end; t += 30 * MIN) {
            sample("HRV", t, hrv);
            sample("TEMP", t, temp);
        }
        for (long t = start; t < end; t += 15 * MIN) {
            sample("SPO2", t, spo2);
        }
    }

    private void stage(String session, String stage, long start, int minutes) {
        jdbc.update("INSERT INTO sleep_stage (session_id, start_ts, end_ts, stage) VALUES (?, ?, ?, ?)",
                session, start, start + minutes * MIN, stage);
    }

    private void sample(String metric, long ts, double value) {
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                device, metric, ts, value);
    }

    /** Un giorno di passi: 800 passi all'ora dalle 8 alle 20, e qualche campione di battito alto. */
    /** Una giornata tranquilla: un campione di stress ogni 30 minuti dalle 7 alle 23, sempre 20. */
    private void calmStress(LocalDate day, double value) {
        for (int minute = 7 * 60; minute < 23 * 60; minute += 30) {
            sample("STRESS", ms(day, minute / 60, minute % 60), value);
        }
    }

    private void walkingDay(LocalDate day) {
        for (int hour = 8; hour <= 20; hour++) {
            sample("STEPS", ms(day, hour, 30), 800);
        }
        for (int i = 0; i < 6; i++) {
            sample("HR", ms(day, 18, i * 5), 120);
        }
    }

    private void twelveStableDays() {
        for (LocalDate d = FIRST; !d.isAfter(LocalDate.of(2026, 11, 13)); d = d.plusDays(1)) {
            night(d, 52, 50, 36.2, 96);
            walkingDay(d);
        }
        service.recomputeFrom(device, FIRST);
    }

    private Integer score(LocalDate day, String kind) {
        return jdbc.query("SELECT value FROM daily_score WHERE device_id = ? AND day = ? AND kind = ?",
                        (rs, i) -> rs.getInt(1), device, day.toString(), kind)
                .stream().findFirst().orElse(null);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE device_id = ?", Integer.class, device);
    }

    // --- calcolo ---

    @Test
    void stressIsScoredOnFinishedDaysOnly() {
        twelveStableDays();
        for (LocalDate d = FIRST; !d.isAfter(TODAY); d = d.plusDays(1)) {
            calmStress(d, 20);
        }
        service.recomputeFrom(device, FIRST);
        assertThat(score(LocalDate.of(2026, 11, 13), "stress")).isEqualTo(85);
        assertThat(score(TODAY, "stress")).isNull();
    }

    @Test
    void stressNumbersAreKeptAsFeaturesForFinishedDays() throws Exception {
        twelveStableDays();
        for (LocalDate d = FIRST; !d.isAfter(TODAY); d = d.plusDays(1)) {
            calmStress(d, 20);
        }
        service.recomputeFrom(device, FIRST);
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-13").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.features.stress_samples").value(32.0))
                .andExpect(jsonPath("$.features.stress_high_share").value(0.0))
                .andExpect(jsonPath("$.features.stress_day_median").value(20.0))
                .andExpect(jsonPath("$.features.stress_evening_median").value(20.0))
                .andExpect(jsonPath("$.stressByHour.length()").value(24))
                .andExpect(jsonPath("$.stressByHour[8]").value(20.0))
                .andExpect(jsonPath("$.stressByHour[3]").doesNotExist());
        // Oggi e' in corso: ha l'andamento per ora ma non i numeri dell'indice.
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-14").header("Authorization", "Bearer " + token))
                .andExpect(jsonPath("$.features.stress_samples").doesNotExist())
                .andExpect(jsonPath("$.stressByHour[8]").value(20.0));
    }

    @Test
    void aDayWithoutStressSamplesHasNoStressByHour() throws Exception {
        twelveStableDays();
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer " + tokens.issue(device)))
                .andExpect(jsonPath("$.stressByHour").doesNotExist())
                .andExpect(jsonPath("$.features.stress_samples").doesNotExist());
    }

    @Test
    void recoveryUsesYesterdaysStress() {
        twelveStableDays();
        Integer without = score(LocalDate.of(2026, 11, 12), "recovery");
        assertThat(without).isNotNull();
        // Ieri (11) una giornata molto tesa: il Recupero del 12 ne risente.
        for (LocalDate d = FIRST; !d.isAfter(LocalDate.of(2026, 11, 13)); d = d.plusDays(1)) {
            calmStress(d, d.equals(LocalDate.of(2026, 11, 11)) ? 90 : 20);
        }
        service.recomputeFrom(device, FIRST);
        assertThat(score(LocalDate.of(2026, 11, 11), "stress")).isLessThan(30);
        assertThat(score(LocalDate.of(2026, 11, 12), "recovery")).isLessThan(without);
    }

    @Test
    void lateStressSamplesRecomputeTheNextDayRecovery() {
        twelveStableDays();
        Integer before = score(LocalDate.of(2026, 11, 8), "recovery");
        calmStress(LocalDate.of(2026, 11, 7), 95);
        // L'ingest dei campioni di un giorno vecchio ricalcola da quel giorno in poi.
        service.recomputeFrom(device, LocalDate.of(2026, 11, 7));
        assertThat(score(LocalDate.of(2026, 11, 7), "stress")).isNotNull();
        assertThat(score(LocalDate.of(2026, 11, 8), "recovery")).isLessThan(before);
    }

    @Test
    void sleepIndexAppearsFromTheFirstNightEvenWithoutABaseline() {
        twelveStableDays();
        assertThat(score(FIRST, "sleep")).isNotNull();
    }

    @Test
    void recoveryNeedsSevenPreviousDaysForItsBaselines() {
        twelveStableDays();
        for (int d = 1; d <= 7; d++) {
            assertThat(score(FIRST.plusDays(d - 1), "recovery")).as("giorno %d", d).isNull();
        }
        assertThat(score(FIRST.plusDays(7), "recovery")).isNotNull();
    }

    @Test
    void aStableSeriesGivesRecoveryOnTheAverage() {
        twelveStableDays();
        // Tutto sulla tua media: 75 per HRV, battito e temperatura; Sonno e Stress (assente) fanno il resto.
        Integer recovery = score(LocalDate.of(2026, 11, 12), "recovery");
        assertThat(recovery).isBetween(60, 90);
    }

    @Test
    void theBaselineIsStoredWithoutTheDayItself() {
        twelveStableDays();
        LocalDate day = FIRST.plusDays(9);
        Integer count = jdbc.queryForObject(
                "SELECT count FROM baseline WHERE device_id = ? AND day = ? AND feature = 'hrv_night'", Integer.class, device, day.toString());
        assertThat(count).isEqualTo(9);
        assertThat(jdbc.queryForList(
                        "SELECT feature FROM baseline WHERE device_id = ? AND day = ?", String.class, device, FIRST.plusDays(3).toString()))
                .isEmpty();
    }

    @Test
    void movementIsComputedForCompleteDaysOnly() {
        twelveStableDays();
        walkingDay(TODAY);
        service.recomputeFrom(device, TODAY);
        assertThat(score(LocalDate.of(2026, 11, 13), "movement")).isNotNull();
        assertThat(score(TODAY, "movement")).isNull();
    }

    @Test
    void sleepDebtCountsTheLastSevenNights() {
        twelveStableDays();
        Double hours = jdbc.queryForObject(
                "SELECT value FROM daily_metric WHERE device_id = ? AND day = '2026-11-12' AND metric = 'sleep_debt'", Double.class, device);
        // 435 minuti contro 480: 45 minuti di deficit ogni notte, 7 notti con pesi che sommano a 7.
        assertThat(hours).isEqualTo(5.25, org.assertj.core.api.Assertions.within(0.001));
    }

    @Test
    void aStableSeriesHasNoFatigueSignals() {
        twelveStableDays();
        String detail = jdbc.queryForObject(
                "SELECT detail FROM daily_metric WHERE device_id = ? AND day = '2026-11-12' AND metric = 'strain_level'", String.class, device);
        assertThat(detail).contains("\"level\":\"none\"");
    }

    @Test
    void fatigueIsFlaggedWhenAllThreeSignalsMoveTogether() {
        twelveStableDays();
        LocalDate tired = LocalDate.of(2026, 11, 14);
        night(tired, 62, 30, 37.4, 96);
        service.recomputeFrom(device, tired);
        String detail = jdbc.queryForObject(
                "SELECT detail FROM daily_metric WHERE device_id = ? AND day = ? AND metric = 'strain_level'", String.class, device, tired.toString());
        assertThat(detail).contains("\"level\":\"high\"").contains("\"count\":3");
        Double deviation = jdbc.queryForObject(
                "SELECT value FROM daily_metric WHERE device_id = ? AND day = ? AND metric = 'temp_deviation'", Double.class, device, tired.toString());
        assertThat(deviation).isEqualTo(1.2, org.assertj.core.api.Assertions.within(0.001));
        // Un giorno pesante pesa sul Recupero.
        assertThat(score(tired, "recovery")).isLessThan(score(LocalDate.of(2026, 11, 12), "recovery"));
    }

    @Test
    void breathingIsOnTrackForAStableSeries() {
        twelveStableDays();
        String detail = jdbc.queryForObject(
                "SELECT detail FROM daily_metric WHERE device_id = ? AND day = '2026-11-12' AND metric = 'spo2_night'", String.class, device);
        assertThat(detail).contains("\"status\":\"ok\"");
    }

    @Test
    void aNapDoesNotReplaceTheMainSleep() {
        night(FIRST, 52, 50, 36.2, 96);
        String nap = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?)",
                nap, device, ms(FIRST, 14, 0), ms(FIRST, 14, 40));
        stage(nap, "light", ms(FIRST, 14, 0), 40);
        service.recomputeFrom(device, FIRST);
        Double asleep = jdbc.queryForObject(
                "SELECT value FROM daily_feature WHERE device_id = ? AND day = ? AND feature = 'sleep_asleep_min'", Double.class, device, FIRST.toString());
        assertThat(asleep).isEqualTo(435.0);
    }

    @Test
    void aSampleBelongsToItsLocalDay() {
        // 23:30 del 1 novembre a Roma e' ancora il 1 novembre; l'1:00 del 2 e' il giorno dopo.
        sample("STEPS", ms(FIRST, 23, 30), 500);
        sample("STEPS", ms(FIRST.plusDays(1), 1, 0), 700);
        service.recomputeFrom(device, FIRST);
        Double day1 = jdbc.queryForObject(
                "SELECT value FROM daily_feature WHERE device_id = ? AND day = ? AND feature = 'steps'", Double.class, device, FIRST.toString());
        Double day2 = jdbc.queryForObject(
                "SELECT value FROM daily_feature WHERE device_id = ? AND day = ? AND feature = 'steps'", Double.class, device, FIRST.plusDays(1).toString());
        assertThat(day1).isEqualTo(500.0);
        assertThat(day2).isEqualTo(700.0);
    }

    // --- ricalcolo ---

    @Test
    void repeatingTheComputationChangesNothing() {
        twelveStableDays();
        int scores = count("daily_score");
        int features = count("daily_feature");
        int baselines = count("baseline");
        int metrics = count("daily_metric");
        List<Integer> values = jdbc.queryForList("SELECT value FROM daily_score WHERE device_id = ? ORDER BY day, kind", Integer.class, device);
        service.recomputeFrom(device, FIRST);
        assertThat(count("daily_score")).isEqualTo(scores);
        assertThat(count("daily_feature")).isEqualTo(features);
        assertThat(count("baseline")).isEqualTo(baselines);
        assertThat(count("daily_metric")).isEqualTo(metrics);
        assertThat(jdbc.queryForList("SELECT value FROM daily_score WHERE device_id = ? ORDER BY day, kind", Integer.class, device))
                .isEqualTo(values);
    }

    @Test
    void anOlderVersionIsKeptWhenTheCurrentOneIsRecomputed() {
        twelveStableDays();
        jdbc.update("INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                + "VALUES (?, '2026-11-05', 'sleep', 'v0', 11, '[]', 1)", device);
        service.recomputeFrom(device, FIRST);
        Integer old = jdbc.queryForObject(
                "SELECT value FROM daily_score WHERE device_id = ? AND day = '2026-11-05' AND algo_version = 'v0'", Integer.class, device);
        assertThat(old).isEqualTo(11);
    }

    @Test
    void aLateUploadInThePastChangesTheDaysThatFollow() {
        twelveStableDays();
        LocalDate checked = LocalDate.of(2026, 11, 12);
        String baselineSql = "SELECT median FROM baseline WHERE device_id = ? AND day = ? AND feature = 'hrv_night'";
        assertThat(jdbc.queryForObject(baselineSql, Double.class, device, checked.toString())).isEqualTo(50.0);
        Integer before = score(checked, "recovery");

        // Dati nuovi per i primi sei giorni: HRV molto piu' alta. La media dei giorni dopo si sposta.
        for (LocalDate d = FIRST; d.isBefore(LocalDate.of(2026, 11, 7)); d = d.plusDays(1)) {
            jdbc.update("UPDATE sample SET value = 90 WHERE device_id = ? AND metric = 'HRV' AND ts >= ? AND ts < ?",
                    device, ms(d.minusDays(1), 23, 30), ms(d, 7, 0));
        }
        service.recomputeFrom(device, FIRST);

        assertThat(jdbc.queryForObject(baselineSql, Double.class, device, checked.toString())).isEqualTo(90.0);
        // Con la nuova media l'HRV di 50 e' molto sotto il solito: il Recupero scende.
        assertThat(score(checked, "recovery")).isLessThan(before);
    }

    @Test
    void recomputingNeverGoesBackMoreThanSixtyDays() {
        night(LocalDate.of(2026, 8, 1), 52, 50, 36.2, 96);
        service.recomputeFrom(device, LocalDate.of(2026, 8, 1));
        assertThat(count("daily_feature")).isZero();
        assertThat(service.today()).isEqualTo(TODAY);
    }

    @Test
    void theNightlyJobRecomputesTheRecentDays() {
        twelveStableDays();
        jdbc.update("DELETE FROM daily_score WHERE device_id = ?", device);
        service.recomputeRecent(3);
        assertThat(score(LocalDate.of(2026, 11, 13), "sleep")).isNotNull();
        assertThat(score(LocalDate.of(2026, 11, 5), "sleep")).isNull();
    }

    // --- lettura ---

    @Test
    void theApiReturnsScoresMetricsAndBaselines() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.day").value("2026-11-12"))
                .andExpect(jsonPath("$.scores.sleep.algoVersion").value("v1"))
                .andExpect(jsonPath("$.scores.sleep.components.length()").value(7))
                .andExpect(jsonPath("$.scores.recovery.value").isNumber())
                .andExpect(jsonPath("$.metrics.sleep_debt.unit").value("h"))
                .andExpect(jsonPath("$.baselines.hrv_night").value(11));
    }

    @Test
    void theApiReturnsTheDayValuesAndHowFarTheyAreFromYourAverage() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.features.hrv_night").value(50.0))
                .andExpect(jsonPath("$.features.resting_hr").value(52.0))
                .andExpect(jsonPath("$.references.hrv_night.median").value(50.0))
                // MAD 0: l'unita' e' la variabilita' minima dell'HRV (2 ms).
                .andExpect(jsonPath("$.references.hrv_night.spread").value(2.0))
                // Giorni tutti uguali: nessuno scostamento dalla tua media.
                .andExpect(jsonPath("$.references.hrv_night.deviation").value(0.0));
    }

    @Test
    void theApiReturnsWhereEachScoreStandsAgainstTheLast28Days() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-13").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scoreReferences.sleep.median").isNumber())
                .andExpect(jsonPath("$.scoreReferences.sleep.spread").value(org.hamcrest.Matchers.greaterThanOrEqualTo(3.0)))
                // Giorni quasi uguali (la regolarita' entra dalla quinta notte): l'indice sta dentro il tuo solito.
                .andExpect(jsonPath("$.scoreReferences.sleep.deviation").value(org.hamcrest.Matchers.closeTo(0.0, 0.5)))
                // Il Recupero esiste da pochi giorni: la sua storia non basta ancora, quindi niente riferimento.
                .andExpect(jsonPath("$.scores.recovery.value").isNumber())
                .andExpect(jsonPath("$.scoreReferences.recovery").doesNotExist());
    }

    @Test
    void aScoreWithLessThanSevenDaysOfHistoryHasNoReference() throws Exception {
        twelveStableDays();
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-04").header("Authorization", "Bearer " + tokens.issue(device)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scores.sleep.value").isNumber())
                .andExpect(jsonPath("$.scoreReferences.sleep").doesNotExist());
    }

    @Test
    void aMuchWorseScoreSitsAtTheBottomOfTheReference() throws Exception {
        twelveStableDays();
        jdbc.update("UPDATE daily_score SET value = 30 WHERE device_id = ? AND kind = 'sleep' AND day = '2026-11-13'", device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-13").header("Authorization", "Bearer " + tokens.issue(device)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scoreReferences.sleep.deviation").value(-3.0));
    }

    @Test
    void theApiReturnsTheUsualSleepStartAndEnd() throws Exception {
        twelveStableDays();
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer " + tokens.issue(device)))
                .andExpect(status().isOk())
                // A letto alle 23:30 del giorno prima (-30) e in piedi alle 07:00 (420), ogni notte.
                .andExpect(jsonPath("$.features.sleep_start_min").value(-30.0))
                .andExpect(jsonPath("$.features.sleep_end_min").value(420.0))
                .andExpect(jsonPath("$.references.sleep_start_min.median").value(-30.0))
                .andExpect(jsonPath("$.references.sleep_end_min.median").value(420.0))
                // Anche le fasi hanno la tua media: stesse notti, 120+60+60+30=270 leggero, 70 profondo.
                .andExpect(jsonPath("$.references.sleep_deep_min.median").value(70.0))
                .andExpect(jsonPath("$.references.sleep_deep_min.spread").value(5.0))
                .andExpect(jsonPath("$.references.sleep_rem_min.median").value(95.0));
    }

    @Test
    void theApiReturnsTheNightWithItsStagesAndTheStepsByHour() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sleep.start").value(ms(LocalDate.of(2026, 11, 11), 23, 30)))
                .andExpect(jsonPath("$.sleep.end").value(ms(LocalDate.of(2026, 11, 12), 7, 0)))
                .andExpect(jsonPath("$.sleep.stages.length()").value(9))
                .andExpect(jsonPath("$.sleep.stages[0].stage").value("awake"))
                .andExpect(jsonPath("$.stepsByHour.length()").value(24))
                .andExpect(jsonPath("$.stepsByHour[8]").value(800))
                .andExpect(jsonPath("$.stepsByHour[3]").value(0));
    }

    @Test
    void aDayWithoutDataHasNoNightAndNoSteps() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-10-01").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sleep").doesNotExist())
                .andExpect(jsonPath("$.stepsByHour").doesNotExist());
    }

    @Test
    void aDayWithoutBaselineHasValuesButNoReference() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-03").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.features.hrv_night").value(50.0))
                .andExpect(jsonPath("$.references.hrv_night").doesNotExist());
    }

    @Test
    void anEarlyDayIsReportedAsCalibrating() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-03").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scores.recovery").doesNotExist())
                .andExpect(jsonPath("$.baselines.hrv_night").doesNotExist());
    }

    @Test
    void aRangeReturnsOneEntryPerDay() throws Exception {
        twelveStableDays();
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days").param("from", "2026-11-10").param("to", "2026-11-13")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[0].day").value("2026-11-10"))
                .andExpect(jsonPath("$[3].day").value("2026-11-13"));
    }

    @Test
    void readingNeedsTheDeviceToken() throws Exception {
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices/" + device + "/days/2026-11-12").header("Authorization", "Bearer nope"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aBadDateOrRangeIsRejected() throws Exception {
        String token = tokens.issue(device);
        mvc.perform(get("/api/v1/devices/" + device + "/days/12-11-2026").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/devices/" + device + "/days").param("from", "2026-11-13").param("to", "2026-11-10")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/devices/" + device + "/days").param("from", "2026-01-01").param("to", "2026-11-10")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-daily-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
