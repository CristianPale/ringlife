package com.ringlife.backend.push;

import java.time.Clock;
import java.util.Base64;
import java.util.Locale;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;

/**
 * Registration of a phone for the encrypted pushes (ADR 0047). Authentication is in the device interceptor. The answers
 * and the errors never repeat the token or the key.
 */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/push")
class PushController {

    /** APNs token in hexadecimal (32 bytes today; Apple may lengthen it, so a range). */
    private static final String TOKEN = "([0-9a-f]{2}){16,100}";

    record RegistrationRequest(String token, String key, String environment) {}

    /** `environment`, `lastSentAt` and `lastError` are null without a registration. */
    record PushStatus(boolean registered, boolean serverReady, String environment, Long lastSentAt, String lastError) {}

    private final PushRegistrations registrations;
    private final ApnsSettings settings;
    private final Clock clock;

    PushController(PushRegistrations registrations, ApnsSettings settings, Clock clock) {
        this.registrations = registrations;
        this.settings = settings;
        this.clock = clock;
    }

    @GetMapping
    PushStatus status(@PathVariable String deviceId) {
        return registrations.find(deviceId)
                .map(r -> new PushStatus(true, settings.serverReady(), r.environment(), r.lastSentAt(), r.lastError()))
                .orElseGet(() -> new PushStatus(false, settings.serverReady(), null, null, null));
    }

    /** Registers the phone, or replaces its token, key or environment. 400 without writing for an invalid field. */
    @PutMapping
    PushStatus register(@PathVariable String deviceId, @RequestBody RegistrationRequest request) {
        if (request == null) {
            throw ApiException.badRequest("Corpo della richiesta non valido");
        }
        String token = required(request.token(), "token").trim().toLowerCase(Locale.ROOT);
        if (!token.matches(TOKEN)) {
            throw ApiException.badRequest("Parametro non valido: token");
        }
        String key = required(request.key(), "key").trim();
        if (!isKey(key)) {
            throw ApiException.badRequest("Parametro non valido: key");
        }
        String environment = required(request.environment(), "environment");
        if (!ApnsSettings.PRODUCTION.equals(environment) && !ApnsSettings.SANDBOX.equals(environment)) {
            throw ApiException.badRequest("Parametro non valido: environment");
        }
        registrations.save(deviceId, token, key, environment, clock.millis());
        return status(deviceId);
    }

    /** Removes the registration; the events waiting for a push go back to the phone's local notifications. */
    @DeleteMapping
    PushStatus unregister(@PathVariable String deviceId) {
        registrations.delete(deviceId);
        return status(deviceId);
    }

    private static String required(String value, String field) {
        if (value == null || value.isBlank()) {
            throw ApiException.badRequest("Campo obbligatorio: " + field);
        }
        return value;
    }

    /** Standard base64 of exactly 32 bytes: the AES-256 key the phone made. */
    private static boolean isKey(String key) {
        try {
            return Base64.getDecoder().decode(key).length == PushCrypto.KEY_BYTES;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
