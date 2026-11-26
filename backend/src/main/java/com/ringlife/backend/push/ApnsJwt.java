package com.ringlife.backend.push;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.time.Clock;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import tools.jackson.databind.ObjectMapper;

/**
 * The provider token for APNs (ADR 0047): a JWT signed with ES256 by the `.p8` key, header `{alg, kid}`, claims
 * `{iss, iat}`. Apple refuses tokens older than an hour and too frequent renewals, so the same token is reused for
 * {@value #REUSE_MINUTES} minutes.
 */
final class ApnsJwt {

    static final int REUSE_MINUTES = 50;
    private static final Base64.Encoder URL = Base64.getUrlEncoder().withoutPadding();

    private final ECPrivateKey key;
    private final String keyId;
    private final String teamId;
    private final Clock clock;
    private final ObjectMapper json;

    private String token;
    private long issuedAt;

    ApnsJwt(ECPrivateKey key, String keyId, String teamId, Clock clock, ObjectMapper json) {
        this.key = key;
        this.keyId = keyId;
        this.teamId = teamId;
        this.clock = clock;
        this.json = json;
    }

    /** The current token: a new one when there is none or the last one is {@value #REUSE_MINUTES} minutes old. */
    synchronized String token() {
        long now = clock.millis();
        if (token == null || now - issuedAt >= REUSE_MINUTES * 60_000L || now < issuedAt) {
            token = sign(now / 1000);
            issuedAt = now;
        }
        return token;
    }

    private String sign(long iatSeconds) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "ES256");
        header.put("kid", keyId);
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", teamId);
        claims.put("iat", iatSeconds);
        String input = URL.encodeToString(json.writeValueAsBytes(header)) + "." + URL.encodeToString(json.writeValueAsBytes(claims));
        try {
            // P1363: the raw R ‖ S that JWS wants, not the DER sequence.
            Signature signature = Signature.getInstance("SHA256withECDSAinP1363Format");
            signature.initSign(key);
            signature.update(input.getBytes(StandardCharsets.US_ASCII));
            return input + "." + URL.encodeToString(signature.sign());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Firma del token APNs fallita", e);
        }
    }
}
