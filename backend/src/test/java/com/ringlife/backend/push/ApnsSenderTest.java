package com.ringlife.backend.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.SecureRandom;
import java.security.Signature;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.ringlife.backend.push.PushSender.Message;
import com.ringlife.backend.push.PushSender.Outcome;
import com.ringlife.backend.push.PushSender.Result;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The request to Apple (ADR 0047) against a local server that stands in for APNs through `ringlife.apns.url`: path,
 * headers, payload with the encrypted text, and what each answer means. Keys made at runtime, synthetic tokens.
 */
class ApnsSenderTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-11-14T11:00:00Z");
    private static final String TOKEN = "ab".repeat(32);

    private HttpServer server;
    private final KeyPair pair = PushTestKeys.ecPair();
    private final byte[] deviceKey = new byte[32];
    private volatile int status = 200;
    private volatile String answer = "";
    private final Map<String, Object> seen = new ConcurrentHashMap<>();

    @BeforeEach
    void start() throws IOException {
        new SecureRandom().nextBytes(deviceKey);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            seen.put("method", exchange.getRequestMethod());
            seen.put("path", exchange.getRequestURI().getPath());
            seen.put("headers", Map.copyOf(exchange.getRequestHeaders()));
            seen.put("body", new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) {
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(bytes);
                }
            }
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private ApnsSender sender() {
        String url = "http://127.0.0.1:" + server.getAddress().getPort();
        return new ApnsSender(
                new ApnsSettings(PushTestKeys.pem(pair), "KEY0000001", "TEAM000001", "com.ringlife.app", url),
                Clock.fixed(NOW, ZoneId.of("UTC")), JSON);
    }

    private PushRegistration registration(String environment) {
        return new PushRegistration("device-1", TOKEN, Base64.getEncoder().encodeToString(deviceKey), environment, 0, 0, null, null);
    }

    private static Message message(boolean timeSensitive) {
        return new Message("Passi sotto 3.000 da 3 giorni", "2.000 passi, sotto 3.000.", "/indici/movimento", List.of("event-one", "event-two"),
                timeSensitive);
    }

    @SuppressWarnings("unchecked")
    private String header(String name) {
        Map<String, List<String>> headers = (Map<String, List<String>>) seen.get("headers");
        return headers.entrySet().stream()
                .filter(e -> e.getKey().equalsIgnoreCase(name))
                .map(e -> e.getValue().get(0))
                .findFirst()
                .orElse(null);
    }

    @Test
    void theRequestCarriesTheTokenTheHeadersAndOnlyTheFallbackTextInClear() throws Exception {
        Outcome outcome = sender().send(registration("production"), message(false));
        assertThat(outcome.result()).isEqualTo(Result.SENT);
        assertThat(outcome.status()).isEqualTo(200);

        assertThat(seen.get("method")).isEqualTo("POST");
        assertThat(seen.get("path")).isEqualTo("/3/device/" + TOKEN);
        assertThat(header("apns-topic")).isEqualTo("com.ringlife.app");
        assertThat(header("apns-push-type")).isEqualTo("alert");
        assertThat(header("apns-priority")).isEqualTo("10");
        assertThat(header("apns-expiration")).isEqualTo(String.valueOf(NOW.getEpochSecond() + 86_400));
        String authorization = header("authorization");
        assertThat(authorization).startsWith("bearer ");
        String[] jwt = authorization.substring("bearer ".length()).split("\\.");
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(pair.getPublic());
        verifier.update((jwt[0] + "." + jwt[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(verifier.verify(Base64.getUrlDecoder().decode(jwt[2]))).isTrue();

        String body = (String) seen.get("body");
        assertThat(body).doesNotContain("Passi").doesNotContain("movimento")
                // The ids hold a "-", which base64 never does: they cannot appear by chance in the ciphertext.
                .doesNotContain("event-one");
        JsonNode payload = JSON.readTree(body);
        JsonNode aps = payload.get("aps");
        assertThat(aps.get("alert").get("title").asString()).isEqualTo("RingLife");
        assertThat(aps.get("alert").get("body").asString()).isEqualTo("Avviso di RingLife");
        assertThat(aps.get("mutable-content").asInt()).isEqualTo(1);
        assertThat(aps.get("thread-id").asString()).isEqualTo("alerts");
        assertThat(aps.get("sound").asString()).isEqualTo("default");
        assertThat(aps.get("interruption-level").asString()).isEqualTo("active");
        assertThat(payload.get("rl").get("v").asInt()).isEqualTo(1);

        JsonNode secret = JSON.readTree(PushCryptoTest.open(deviceKey, payload.get("rl").get("c").asString()));
        assertThat(secret.get("title").asString()).isEqualTo("Passi sotto 3.000 da 3 giorni");
        assertThat(secret.get("body").asString()).isEqualTo("2.000 passi, sotto 3.000.");
        assertThat(secret.get("route").asString()).isEqualTo("/indici/movimento");
        assertThat(secret.get("ids").get(0).asString()).isEqualTo("event-one");
        assertThat(secret.get("ids").get(1).asString()).isEqualTo("event-two");
        assertThat(payload.size()).isEqualTo(2);
    }

    @Test
    void importantAsksForTheTimeSensitiveLevel() {
        sender().send(registration("sandbox"), message(true));
        assertThat(JSON.readTree((String) seen.get("body")).get("aps").get("interruption-level").asString()).isEqualTo("time-sensitive");
    }

    @Test
    void eachAnswerHasItsMeaning() {
        ApnsSender sender = sender();
        status = 410;
        answer = "{\"reason\":\"Unregistered\",\"timestamp\":1794654000000}";
        assertThat(sender.send(registration("production"), message(false))).isEqualTo(new Outcome(Result.INVALID_TOKEN, 410, "Unregistered"));

        status = 400;
        for (String reason : List.of("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic")) {
            answer = "{\"reason\":\"" + reason + "\"}";
            assertThat(sender.send(registration("production"), message(false)).result()).isEqualTo(Result.INVALID_TOKEN);
        }
        answer = "{\"reason\":\"PayloadTooLarge\"}";
        assertThat(sender.send(registration("production"), message(false))).isEqualTo(new Outcome(Result.REJECTED, 400, "PayloadTooLarge"));

        status = 403;
        answer = "{\"reason\":\"InvalidProviderToken\"}";
        assertThat(sender.send(registration("production"), message(false)).result()).isEqualTo(Result.REJECTED);

        status = 500;
        answer = "{\"reason\":\"InternalServerError\"}";
        assertThat(sender.send(registration("production"), message(false))).isEqualTo(new Outcome(Result.RETRY, 500, "InternalServerError"));
        status = 503;
        answer = "";
        assertThat(sender.send(registration("production"), message(false))).isEqualTo(new Outcome(Result.RETRY, 503, "HTTP 503"));
        status = 429;
        answer = "{\"reason\":\"TooManyRequests\"}";
        assertThat(sender.send(registration("production"), message(false)).result()).isEqualTo(Result.RETRY);

        // A reason that is not a plain word is not kept.
        status = 400;
        answer = "{\"reason\":\"<script>\"}";
        assertThat(sender.send(registration("production"), message(false))).isEqualTo(new Outcome(Result.REJECTED, 400, "HTTP 400"));
    }

    @Test
    void noAnswerIsARetryAndNeverSaysTheToken() {
        ApnsSender sender = sender();
        server.stop(0);
        Outcome outcome = sender.send(registration("production"), message(false));
        assertThat(outcome.result()).isEqualTo(Result.RETRY);
        assertThat(outcome.status()).isZero();
        assertThat(outcome.reason()).startsWith("Rete: ").doesNotContain(TOKEN);
    }

    @Test
    void withoutTheServerKeyNothingIsSent() {
        ApnsSender sender = new ApnsSender(new ApnsSettings("", "", "", "", "http://127.0.0.1:" + server.getAddress().getPort()),
                Clock.fixed(NOW, ZoneId.of("UTC")), JSON);
        assertThat(sender.send(registration("production"), message(false)).result()).isEqualTo(Result.REJECTED);
        assertThat(seen).isEmpty();
    }

    @Test
    void theRegistrationNeverPrintsTokenOrKey() {
        PushRegistration registration = registration("production");
        assertThat(registration.toString()).doesNotContain(TOKEN).doesNotContain(registration.key());
    }
}
