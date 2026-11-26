package com.ringlife.backend.push;

import java.security.interfaces.ECPrivateKey;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Configuration of the encrypted pushes (ADR 0047): the APNs `.p8` key, its id, the Apple team and the topic (the app's
 * bundle id). Without key, key id or team the pushes are off (`serverReady` false) and everything stays as in phase 1.
 * `url` replaces Apple's hosts, for tests only.
 */
@Component
public class ApnsSettings {

    private static final Logger LOG = LoggerFactory.getLogger(ApnsSettings.class);

    static final String PRODUCTION_URL = "https://api.push.apple.com";
    static final String SANDBOX_URL = "https://api.sandbox.push.apple.com";
    public static final String PRODUCTION = "production";
    public static final String SANDBOX = "sandbox";

    private final ECPrivateKey key;
    private final String keyId;
    private final String teamId;
    private final String topic;
    private final String url;

    @Autowired
    ApnsSettings(
            @Value("${ringlife.apns.key:}") String key,
            @Value("${ringlife.apns.key-id:}") String keyId,
            @Value("${ringlife.apns.team-id:}") String teamId,
            @Value("${ringlife.apns.topic:com.ringlife.app}") String topic,
            @Value("${ringlife.apns.url:}") String url) {
        this.key = parse(key);
        this.keyId = keyId == null ? "" : keyId.trim();
        this.teamId = teamId == null ? "" : teamId.trim();
        this.topic = topic == null || topic.isBlank() ? "com.ringlife.app" : topic.trim();
        this.url = url == null ? "" : url.trim().replaceAll("/+$", "");
        if (this.key != null && (this.keyId.isEmpty() || this.teamId.isEmpty())) {
            LOG.warn("Push spente: mancano l'id della chiave APNs o il team Apple.");
        }
    }

    /** For tests: an already parsed key. */
    public ApnsSettings(ECPrivateKey key, String keyId, String teamId, String topic, String url) {
        this.key = key;
        this.keyId = keyId;
        this.teamId = teamId;
        this.topic = topic;
        this.url = url == null ? "" : url;
    }

    private static ECPrivateKey parse(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return ApnsKeys.parse(text);
        } catch (IllegalArgumentException e) {
            LOG.warn("Push spente: {}", e.getMessage());
            return null;
        }
    }

    /** Whether the server can send pushes: key, key id and team are all there. */
    public boolean serverReady() {
        return key != null && !keyId.isEmpty() && !teamId.isEmpty();
    }

    ECPrivateKey key() {
        return key;
    }

    String keyId() {
        return keyId;
    }

    String teamId() {
        return teamId;
    }

    String topic() {
        return topic;
    }

    /** Apple's host for the environment of the registration, or the override. */
    String baseUrl(String environment) {
        if (!url.isEmpty()) {
            return url;
        }
        return SANDBOX.equals(environment) ? SANDBOX_URL : PRODUCTION_URL;
    }
}
