package com.ringlife.backend.push;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * The push to Apple (ADR 0047): HTTP/2 POST to `/3/device/<token>` with the provider token. Apple sees only the token,
 * the time, the size, the fallback text «RingLife» / «Avviso di RingLife» and the interruption level: title, body, page
 * and event ids travel encrypted in `rl.c` with the key of the device. Never throws and never logs token or key.
 */
@Component
class ApnsSender implements PushSender {

    static final String FALLBACK_TITLE = "RingLife";
    static final String FALLBACK_BODY = "Avviso di RingLife";
    static final String THREAD = "alerts";
    /** Apple keeps trying to deliver for a day, then drops the push: the alert is in the app's list anyway. */
    static final Duration EXPIRATION = Duration.ofDays(1);

    /** Reasons of a 400 that mean the token is no longer good for this app. */
    static final Set<String> INVALID_TOKEN_REASONS = Set.of("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic");

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private final ApnsSettings settings;
    private final Clock clock;
    private final ObjectMapper json;
    private final HttpClient http;
    private ApnsJwt jwt;

    ApnsSender(ApnsSettings settings, Clock clock, ObjectMapper json) {
        this.settings = settings;
        this.clock = clock;
        this.json = json;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_2)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    @Override
    public Outcome send(PushRegistration registration, Message message) {
        if (!settings.serverReady()) {
            return new Outcome(Result.REJECTED, 0, "Push spente sul server");
        }
        byte[] payload;
        try {
            payload = payload(registration, message);
        } catch (RuntimeException e) {
            return new Outcome(Result.REJECTED, 0, "Chiave del dispositivo non valida");
        }
        long now = clock.millis();
        try {
            URI uri = URI.create(settings.baseUrl(registration.environment()) + "/3/device/" + registration.token());
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(20))
                    .header("authorization", "bearer " + jwt().token())
                    .header("apns-topic", settings.topic())
                    .header("apns-push-type", "alert")
                    .header("apns-priority", "10")
                    .header("apns-expiration", String.valueOf((now + EXPIRATION.toMillis()) / 1000))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return outcome(response.statusCode(), response.body());
        } catch (IOException e) {
            // Only the type: a message could carry the address, which contains the token.
            return new Outcome(Result.RETRY, 0, "Rete: " + e.getClass().getSimpleName());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Outcome(Result.RETRY, 0, "Interrotto");
        } catch (RuntimeException e) {
            return new Outcome(Result.RETRY, 0, "Errore: " + e.getClass().getSimpleName());
        }
    }

    /**
     * The JSON Apple receives: visible push with the fallback text, `mutable-content` so the notification extension can
     * decrypt it, and `rl` with the version and the base64 of nonce ‖ ciphertext ‖ tag.
     */
    byte[] payload(PushRegistration registration, Message message) {
        Map<String, Object> secret = new LinkedHashMap<>();
        secret.put("title", message.title());
        secret.put("body", message.body());
        secret.put("route", message.route());
        secret.put("ids", message.ids());
        String sealed = PushCrypto.seal(Base64.getDecoder().decode(registration.key()), json.writeValueAsBytes(secret));

        Map<String, Object> alert = new LinkedHashMap<>();
        alert.put("title", FALLBACK_TITLE);
        alert.put("body", FALLBACK_BODY);
        Map<String, Object> aps = new LinkedHashMap<>();
        aps.put("alert", alert);
        aps.put("mutable-content", 1);
        aps.put("thread-id", THREAD);
        aps.put("sound", "default");
        aps.put("interruption-level", message.timeSensitive() ? "time-sensitive" : "active");
        Map<String, Object> rl = new LinkedHashMap<>();
        rl.put("v", 1);
        rl.put("c", sealed);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("aps", aps);
        body.put("rl", rl);
        return json.writeValueAsBytes(body);
    }

    private Outcome outcome(int status, String body) {
        String reason = reason(body);
        if (status == 200) {
            return new Outcome(Result.SENT, status, null);
        }
        if (status == 410 || (status == 400 && reason != null && INVALID_TOKEN_REASONS.contains(reason))) {
            return new Outcome(Result.INVALID_TOKEN, status, reason);
        }
        if (status == 429 || status >= 500) {
            return new Outcome(Result.RETRY, status, reason != null ? reason : "HTTP " + status);
        }
        if (status == 403 && "ExpiredProviderToken".equals(reason)) {
            // The next push signs a fresh provider token.
            resetJwt();
        }
        return new Outcome(Result.REJECTED, status, reason != null ? reason : "HTTP " + status);
    }

    /** Apple's `reason`, only when it is a plain word: nothing else from the answer is kept. */
    private String reason(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            Map<String, Object> values = json.readValue(body, MAP);
            Object reason = values == null ? null : values.get("reason");
            return reason instanceof String text && text.matches("[A-Za-z]{1,64}") ? text : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private synchronized ApnsJwt jwt() {
        if (jwt == null) {
            jwt = new ApnsJwt(settings.key(), settings.keyId(), settings.teamId(), clock, json);
        }
        return jwt;
    }

    private synchronized void resetJwt() {
        jwt = null;
    }
}
