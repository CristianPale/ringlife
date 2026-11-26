package com.ringlife.backend.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
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

import com.ringlife.backend.compute.ComputeSettings;
import com.ringlife.backend.device.TokenService;
import com.ringlife.backend.push.ApnsSettings;
import com.ringlife.backend.push.PushRegistration;
import com.ringlife.backend.push.PushRegistrations;
import com.ringlife.backend.push.PushSender;
import com.ringlife.backend.push.PushSender.Message;
import com.ringlife.backend.push.PushSender.Outcome;
import com.ringlife.backend.push.PushSender.Result;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Encrypted pushes of the alerts (ADR 0047) with a real database, a clock moved by hand and a fake Apple: registration,
 * push state of new events, quiet hours, `deliverAfter`, one push per device, lock screen, cutoff and retries. The APNs
 * key is made at runtime; tokens and values are synthetic.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AlertPushTest {

    private static final Path DB_DIR = createTempDir();
    private static final ZoneId ROME = ZoneId.of("Europe/Rome");
    private static final Instant NOON = Instant.parse("2026-11-14T11:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 14);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "cd".repeat(32);
    private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);

    static final MovingClock CLOCK = new MovingClock();
    static final FakeApple APPLE = new FakeApple();

    /** A clock the test moves by hand. */
    static final class MovingClock extends Clock {
        volatile Instant now = NOON;

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    /** Records the pushes and answers with the queued outcomes, then with 200. */
    static final class FakeApple implements PushSender {
        final List<Message> sent = new ArrayList<>();
        final Deque<Outcome> answers = new ArrayDeque<>();

        @Override
        public synchronized Outcome send(PushRegistration registration, Message message) {
            sent.add(message);
            return answers.isEmpty() ? new Outcome(Result.SENT, 200, null) : answers.poll();
        }
    }

    @TestConfiguration
    static class Fakes {
        @Bean
        @Primary
        Clock movingClock() {
            return CLOCK;
        }

        @Bean
        @Primary
        PushSender fakeApple() {
            return APPLE;
        }

        @Bean
        @Primary
        ApnsSettings readyApns() {
            try {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
                generator.initialize(new ECGenParameterSpec("secp256r1"));
                return new ApnsSettings((ECPrivateKey) generator.generateKeyPair().getPrivate(), "KEY0000001", "TEAM000001",
                        "com.ringlife.app", "http://127.0.0.1:9");
            } catch (GeneralSecurityException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("push.sqlite").toString());
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

    @Autowired
    AlertPush push;

    @Autowired
    AlertRepository repository;

    @Autowired
    PushRegistrations registrations;

    @Autowired
    ComputeSettings compute;

    private String device;
    private String token;

    @BeforeEach
    void fresh() {
        for (String table : List.of(
                "alert_event", "alert_rule", "alert_custom_rule", "alert_settings", "push_registration", "plugin_result", "plugin_state",
                "daily_metric", "daily_score", "baseline", "daily_feature", "sleep_stage", "sleep_session", "sample", "sync_log",
                "api_token", "device")) {
            jdbc.update("DELETE FROM " + table);
        }
        CLOCK.now = NOON;
        synchronized (APPLE) {
            APPLE.sent.clear();
            APPLE.answers.clear();
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

    private void metric(LocalDate day, String name, double value, String unit) {
        jdbc.update("INSERT INTO daily_metric (device_id, day, metric, algo_version, value, unit, detail, computed_at) "
                + "VALUES (?, ?, ?, 'v1', ?, ?, NULL, 0)", device, day.toString(), name, value, unit);
    }

    private void score(LocalDate day, String kind, int value) {
        jdbc.update("INSERT INTO daily_score (device_id, day, kind, algo_version, value, components, computed_at) "
                + "VALUES (?, ?, ?, 'v1', ?, '[]', 0)", device, day.toString(), kind, value);
    }

    private static long at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ROME).toInstant().toEpochMilli();
    }

    private void warmNight(LocalDate day) {
        jdbc.update("INSERT INTO sleep_session (id, device_id, start_ts, end_ts) VALUES (?, ?, ?, ?)",
                UUID.randomUUID().toString(), device, at(day.minusDays(1), 23, 0), at(day, 7, 0));
        jdbc.update("INSERT INTO sample (device_id, metric, ts, value) VALUES (?, 'HR', ?, 70)", device, at(day, 7, 45));
        feature(day, "temp_night", 34.9);
        baseline(day, "temp_night", 34.3, 0.34);
        metric(day, "temp_deviation", 0.6, "C");
    }

    /** Two warm nights in a row: the temperature event of today. */
    private void temperatureEvent() {
        warmNight(TODAY.minusDays(1));
        warmNight(TODAY);
        alerts.evaluateToday(device);
    }

    // --- HTTP ---

    private ResultActions register(String body) throws Exception {
        return mvc.perform(put("/api/v1/devices/" + device + "/push")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private void registered() throws Exception {
        register("{ \"token\": \"" + TOKEN + "\", \"key\": \"" + KEY + "\", \"environment\": \"sandbox\" }").andExpect(status().isOk());
    }

    private ResultActions pushStatus() throws Exception {
        return mvc.perform(get("/api/v1/devices/" + device + "/push").header("Authorization", "Bearer " + token));
    }

    private void putConfig(String body) throws Exception {
        mvc.perform(put("/api/v1/devices/" + device + "/alerts/config")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private JsonNode events() throws Exception {
        return JSON.readTree(mvc.perform(get("/api/v1/devices/" + device + "/alerts?since=0").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString()).get("events");
    }

    private List<String> pushStates() {
        return jdbc.queryForList(
                "SELECT rule_id || ' ' || push_state FROM alert_event WHERE device_id = ? ORDER BY rule_id", String.class, device);
    }

    private Long dueAt(String rule) {
        return jdbc.queryForObject("SELECT push_due_at FROM alert_event WHERE device_id = ? AND rule_id = ?", Long.class, device, rule);
    }

    private List<Message> sent() {
        synchronized (APPLE) {
            return List.copyOf(APPLE.sent);
        }
    }

    // --- registration ---

    @Test
    void aPhoneRegistersChangesAndLeaves() throws Exception {
        pushStatus().andExpect(status().isOk())
                .andExpect(jsonPath("$.registered").value(false))
                .andExpect(jsonPath("$.serverReady").value(true))
                .andExpect(jsonPath("$.environment").isEmpty())
                .andExpect(jsonPath("$.lastSentAt").isEmpty())
                .andExpect(jsonPath("$.lastError").isEmpty());

        register("{ \"token\": \"" + TOKEN.toUpperCase() + "\", \"key\": \"" + KEY + "\", \"environment\": \"production\" }")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registered").value(true))
                .andExpect(jsonPath("$.environment").value("production"))
                .andExpect(jsonPath("$.token").doesNotExist())
                .andExpect(jsonPath("$.key").doesNotExist());
        PushRegistration stored = registrations.find(device).orElseThrow();
        assertThat(stored.token()).isEqualTo(TOKEN);
        assertThat(stored.key()).isEqualTo(KEY);

        registered();
        pushStatus().andExpect(jsonPath("$.environment").value("sandbox"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_registration", Integer.class)).isEqualTo(1);

        mvc.perform(delete("/api/v1/devices/" + device + "/push").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registered").value(false));
        assertThat(registrations.find(device)).isEmpty();
    }

    @Test
    void anInvalidRegistrationIsRefusedWithoutRepeatingIt() throws Exception {
        String shortKey = Base64.getEncoder().encodeToString(new byte[16]);
        List<String[]> bad = List.of(
                new String[] {"{ \"key\": \"" + KEY + "\", \"environment\": \"sandbox\" }", "Campo obbligatorio: token"},
                new String[] {"{ \"token\": \"zz" + TOKEN.substring(2) + "\", \"key\": \"" + KEY + "\", \"environment\": \"sandbox\" }",
                        "Parametro non valido: token"},
                new String[] {"{ \"token\": \"abc\", \"key\": \"" + KEY + "\", \"environment\": \"sandbox\" }", "Parametro non valido: token"},
                new String[] {"{ \"token\": \"" + TOKEN + "\", \"environment\": \"sandbox\" }", "Campo obbligatorio: key"},
                new String[] {"{ \"token\": \"" + TOKEN + "\", \"key\": \"" + shortKey + "\", \"environment\": \"sandbox\" }",
                        "Parametro non valido: key"},
                new String[] {"{ \"token\": \"" + TOKEN + "\", \"key\": \"non base64!\", \"environment\": \"sandbox\" }",
                        "Parametro non valido: key"},
                new String[] {"{ \"token\": \"" + TOKEN + "\", \"key\": \"" + KEY + "\" }", "Campo obbligatorio: environment"},
                new String[] {"{ \"token\": \"" + TOKEN + "\", \"key\": \"" + KEY + "\", \"environment\": \"test\" }",
                        "Parametro non valido: environment"});
        for (String[] body : bad) {
            String error = register(body[0]).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value(body[1]))
                    .andReturn().getResponse().getContentAsString();
            assertThat(error).doesNotContain(TOKEN.substring(2)).doesNotContain(KEY);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_registration", Integer.class)).isZero();

        String other = tokens.issue(newDevice());
        mvc.perform(get("/api/v1/devices/" + device + "/push").header("Authorization", "Bearer " + other))
                .andExpect(status().isUnauthorized());
    }

    // --- push state of new events ---

    @Test
    void withoutRegistrationEventsStayWithThePhone() throws Exception {
        temperatureEvent();
        assertThat(events().get(0).get("push").asString()).isEqualTo("none");
        push.sendDue();
        assertThat(sent()).isEmpty();
    }

    @Test
    void anEventOfARegisteredPhoneGoesOutAloneWithItsTextAndPage() throws Exception {
        registered();
        temperatureEvent();
        assertThat(events().get(0).get("push").asString()).isEqualTo("pending");
        assertThat(dueAt("temperature")).isEqualTo(NOON.toEpochMilli());

        CLOCK.now = NOON.plusSeconds(60);
        push.sendDue();
        assertThat(sent()).hasSize(1);
        Message message = sent().get(0);
        assertThat(message.title()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(message.body()).startsWith("+0,6 °C rispetto alla tua media");
        assertThat(message.route()).isEqualTo("/indici/recupero");
        assertThat(message.ids()).containsExactly(events().get(0).get("id").asString());
        assertThat(message.timeSensitive()).isFalse();
        assertThat(events().get(0).get("push").asString()).isEqualTo("sent");
        assertThat(jdbc.queryForObject("SELECT pushed_at FROM alert_event WHERE device_id = ?", Long.class, device))
                .isEqualTo(NOON.plusSeconds(60).toEpochMilli());
        pushStatus().andExpect(jsonPath("$.lastSentAt").value(NOON.plusSeconds(60).toEpochMilli())).andExpect(jsonPath("$.lastError").isEmpty());

        // Nothing left to send.
        push.sendDue();
        assertThat(sent()).hasSize(1);
    }

    @Test
    void theListOnlyDeliveryIsNeverPushed() throws Exception {
        registered();
        putConfig("{ \"rules\": { \"temperature\": { \"delivery\": \"elenco\" } } }");
        temperatureEvent();
        assertThat(pushStates()).containsExactly("temperature none");
        push.sendDue();
        assertThat(sent()).isEmpty();
    }

    @Test
    void quietHoursMoveThePushToTheirEnd() throws Exception {
        registered();
        // 23:00 in Rome, inside 22:30-07:00: the push waits for 07:00 of the next day.
        CLOCK.now = Instant.parse("2026-11-14T22:00:00Z");
        temperatureEvent();
        assertThat(dueAt("temperature")).isEqualTo(Instant.parse("2026-11-15T06:00:00Z").toEpochMilli());
        push.sendDue();
        CLOCK.now = Instant.parse("2026-11-15T05:59:00Z");
        push.sendDue();
        assertThat(sent()).isEmpty();
        CLOCK.now = Instant.parse("2026-11-15T06:00:00Z");
        push.sendDue();
        assertThat(sent()).hasSize(1);
        assertThat(pushStates()).containsExactly("temperature sent");
    }

    @Test
    void theQuietHoursFollowTheAppRule() {
        ZoneId zone = compute.zone();
        long at2300 = Instant.parse("2026-11-14T22:00:00Z").toEpochMilli();
        long at0300 = Instant.parse("2026-11-15T02:00:00Z").toEpochMilli();
        long at0700 = Instant.parse("2026-11-15T06:00:00Z").toEpochMilli();
        long at1200 = NOON.toEpochMilli();
        assertThat(AlertPush.afterQuietHours(at2300, "22:30", "07:00", zone)).isEqualTo(at0700);
        assertThat(AlertPush.afterQuietHours(at0300, "22:30", "07:00", zone)).isEqualTo(at0700);
        assertThat(AlertPush.afterQuietHours(at0700, "22:30", "07:00", zone)).isEqualTo(at0700);
        assertThat(AlertPush.afterQuietHours(at1200, "22:30", "07:00", zone)).isEqualTo(at1200);
        // A window within the day, equal times (none) and invalid times (none).
        assertThat(AlertPush.afterQuietHours(at1200, "11:00", "14:00", zone)).isEqualTo(Instant.parse("2026-11-14T13:00:00Z").toEpochMilli());
        assertThat(AlertPush.afterQuietHours(at2300, "22:00", "22:00", zone)).isEqualTo(at2300);
        assertThat(AlertPush.afterQuietHours(at2300, "25:00", "07:00", zone)).isEqualTo(at2300);
    }

    @Test
    void deliverAfterHoldsThePushUntilItsTime() throws Exception {
        registered();
        warmNight(TODAY);
        metric(TODAY, "sleep_debt", 7.5, "h");
        putConfig("{ \"rules\": { \"temperature\": { \"enabled\": false }, \"sleep-debt\": { \"enabled\": true } } }");
        long nine = Instant.parse("2026-11-14T20:00:00Z").toEpochMilli();
        assertThat(dueAt("sleep-debt")).isEqualTo(nine);
        push.sendDue();
        assertThat(sent()).isEmpty();
        CLOCK.now = Instant.ofEpochMilli(nine);
        push.sendDue();
        assertThat(sent()).extracting(Message::title).containsExactly("Debito di sonno oltre 6 ore");

        // A sleep debt after 21:00 with quiet hours from 20:00: the next morning.
        jdbc.update("DELETE FROM alert_event");
        putConfig("{ \"settings\": { \"quietStart\": \"20:00\" } }");
        alerts.evaluateToday(device);
        assertThat(dueAt("sleep-debt")).isEqualTo(Instant.parse("2026-11-15T06:00:00Z").toEpochMilli());
    }

    @Test
    void severalEventsBecomeOnePushAndImportantAsksForTimeSensitive() throws Exception {
        registered();
        putConfig("{ \"rules\": { \"recovery-low\": { \"delivery\": \"importante\" } } }");
        for (int i = 0; i < 3; i++) {
            score(TODAY.minusDays(i), "recovery", 60);
        }
        temperatureEvent();
        assertThat(pushStates()).containsExactly("recovery-low pending", "temperature pending");

        push.sendDue();
        assertThat(sent()).hasSize(1);
        Message message = sent().get(0);
        assertThat(message.title()).isEqualTo("2 avvisi");
        assertThat(message.body()).isEqualTo("Recupero basso da 3 giorni; Temperatura della notte sopra il tuo solito.");
        assertThat(message.route()).isEqualTo("/avvisi");
        assertThat(message.ids()).hasSize(2);
        assertThat(message.timeSensitive()).isTrue();
        assertThat(pushStates()).containsExactly("recovery-low sent", "temperature sent");
    }

    @Test
    void theGenericLockScreenSaysOnlyThatThereIsAnAlert() throws Exception {
        registered();
        putConfig("{ \"settings\": { \"lockScreen\": \"generico\" } }");
        temperatureEvent();
        push.sendDue();
        assertThat(sent().get(0)).isEqualTo(new Message("RingLife", "Un nuovo avviso.", "/avvisi", sent().get(0).ids(), false));

        jdbc.update("DELETE FROM alert_event");
        for (int i = 0; i < 3; i++) {
            score(TODAY.minusDays(i), "recovery", 60);
        }
        alerts.evaluateToday(device);
        push.sendDue();
        Message second = sent().get(1);
        assertThat(second.title()).isEqualTo("RingLife");
        assertThat(second.body()).isEqualTo("2 nuovi avvisi.");
        assertThat(second.route()).isEqualTo("/avvisi");
    }

    @Test
    void anEventOlderThanThreeDaysIsNeverPushed() throws Exception {
        registered();
        long old = NOON.minus(Duration.ofDays(3)).minusSeconds(60).toEpochMilli();
        jdbc.update("INSERT INTO alert_event (id, device_id, rule_id, day, level, title, body, route, values_json, created_at, push_state, "
                        + "push_due_at) VALUES ('old', ?, 'hrv', '2026-11-11', 'attenzione', 'Vecchio', 'Vecchio.', '/indici/recupero', '{}', ?, "
                        + "'pending', ?)",
                device, old, old);
        push.sendDue();
        assertThat(sent()).isEmpty();
        assertThat(pushStates()).containsExactly("hrv failed");
    }

    @Test
    void networkErrorsAreRetriedThreeTimesThenTheEventFails() throws Exception {
        registered();
        temperatureEvent();
        synchronized (APPLE) {
            for (int i = 0; i < 3; i++) {
                APPLE.answers.add(new Outcome(Result.RETRY, 503, "HTTP 503"));
            }
        }
        push.sendDue();
        assertThat(pushStates()).containsExactly("temperature pending");
        pushStatus().andExpect(jsonPath("$.lastError").value("HTTP 503"));
        push.sendDue();
        assertThat(pushStates()).containsExactly("temperature pending");
        push.sendDue();
        assertThat(pushStates()).containsExactly("temperature failed");
        assertThat(jdbc.queryForObject("SELECT push_attempts FROM alert_event WHERE device_id = ?", Integer.class, device)).isEqualTo(3);
        push.sendDue();
        assertThat(sent()).hasSize(3);
        assertThat(events().get(0).get("push").asString()).isEqualTo("failed");
    }

    @Test
    void aRetryThenASuccessSendsOnTheNextRound() throws Exception {
        registered();
        temperatureEvent();
        synchronized (APPLE) {
            APPLE.answers.add(new Outcome(Result.RETRY, 0, "Rete: ConnectException"));
        }
        push.sendDue();
        push.sendDue();
        assertThat(sent()).hasSize(2);
        assertThat(pushStates()).containsExactly("temperature sent");
        pushStatus().andExpect(jsonPath("$.lastError").isEmpty());
    }

    @Test
    void aTokenAppleNoLongerKnowsRemovesTheRegistration() throws Exception {
        registered();
        temperatureEvent();
        // Another event, due later: it goes back to the phone with the registration.
        putConfig("{ \"rules\": { \"sleep-debt\": { \"enabled\": true } } }");
        metric(TODAY, "sleep_debt", 7.5, "h");
        alerts.evaluateToday(device);
        assertThat(pushStates()).containsExactly("sleep-debt pending", "temperature pending");
        synchronized (APPLE) {
            APPLE.answers.add(new Outcome(Result.INVALID_TOKEN, 410, "Unregistered"));
        }
        push.sendDue();
        assertThat(pushStates()).containsExactly("sleep-debt none", "temperature failed");
        assertThat(registrations.find(device)).isEmpty();
        pushStatus().andExpect(jsonPath("$.registered").value(false));
    }

    @Test
    void aRefusedPushFailsAndSaysWhy() throws Exception {
        registered();
        temperatureEvent();
        synchronized (APPLE) {
            APPLE.answers.add(new Outcome(Result.REJECTED, 400, "PayloadTooLarge"));
        }
        push.sendDue();
        assertThat(pushStates()).containsExactly("temperature failed");
        pushStatus().andExpect(jsonPath("$.registered").value(true)).andExpect(jsonPath("$.lastError").value("PayloadTooLarge"));
    }

    @Test
    void leavingGivesTheWaitingEventsBackToThePhone() throws Exception {
        registered();
        CLOCK.now = Instant.parse("2026-11-14T22:00:00Z");
        temperatureEvent();
        mvc.perform(delete("/api/v1/devices/" + device + "/push").header("Authorization", "Bearer " + token));
        assertThat(pushStates()).containsExactly("temperature none");
        CLOCK.now = Instant.parse("2026-11-15T06:00:00Z");
        push.sendDue();
        assertThat(sent()).isEmpty();
    }

    @Test
    void withoutTheServerKeyThePushesAreOffAndTheWaitingOnesGoBack() throws Exception {
        registered();
        temperatureEvent();
        AlertPush off = new AlertPush(repository, registrations, new ApnsSettings((ECPrivateKey) null, "", "", "com.ringlife.app", ""),
                APPLE, compute, CLOCK, JSON);
        assertThat(off.activeFor(device)).isFalse();
        assertThat(off.plan(off.activeFor(device), "notifica", null, AlertCatalog.DEFAULT_SETTINGS, NOON.toEpochMilli()))
                .isEqualTo(new AlertPush.Plan("none", null));
        off.sendDue();
        assertThat(sent()).isEmpty();
        assertThat(pushStates()).containsExactly("temperature none");
    }

    @Test
    void anotherDevicesEventsGoInTheirOwnPush() throws Exception {
        registered();
        temperatureEvent();
        String first = device;
        device = newDevice();
        token = tokens.issue(device);
        registered();
        temperatureEvent();
        push.sendDue();
        assertThat(sent()).hasSize(2).allSatisfy(m -> assertThat(m.ids()).hasSize(1));
        device = first;
        assertThat(pushStates()).containsExactly("temperature sent");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-push");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
