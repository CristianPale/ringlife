package com.ringlife.backend.device;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Token per dispositivo. Si salva solo l'hash SHA-256: il token in chiaro non si può rileggere. */
@Service
public class TokenService {

    private static final int TOKEN_BYTES = 32;

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public TokenService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Emette un token nuovo e revoca i precedenti dello stesso dispositivo. Restituisce il token in chiaro. */
    public String issue(String deviceId) {
        long now = clock.millis();
        jdbc.update("UPDATE api_token SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL", now, deviceId);
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update(
                "INSERT INTO api_token (id, device_id, token_hash, created_at) VALUES (?, ?, ?, ?)",
                UUID.randomUUID().toString(), deviceId, hash(token), now);
        return token;
    }

    /** Il dispositivo a cui appartiene un token valido (non revocato). */
    public Optional<String> deviceFor(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return jdbc.query(
                        "SELECT device_id FROM api_token WHERE token_hash = ? AND revoked_at IS NULL",
                        (rs, i) -> rs.getString(1),
                        hash(token))
                .stream()
                .findFirst();
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
