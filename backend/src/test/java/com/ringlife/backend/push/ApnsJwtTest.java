package com.ringlife.backend.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The ES256 provider token for APNs (ADR 0047), with a key made at runtime. */
class ApnsJwtTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-11-14T11:00:00Z");

    /** A clock the test moves by hand. */
    static final class MovingClock extends Clock {
        Instant now;

        MovingClock(Instant now) {
            this.now = now;
        }

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

    private static JsonNode part(String token, int index) {
        return JSON.readTree(Base64.getUrlDecoder().decode(token.split("\\.")[index]));
    }

    @Test
    void theTokenIsSignedWithEs256AndSaysKeyTeamAndTime() throws Exception {
        KeyPair pair = PushTestKeys.ecPair();
        ApnsJwt jwt = new ApnsJwt((ECPrivateKey) pair.getPrivate(), "KEY0000001", "TEAM000001", Clock.fixed(NOW, ZoneId.of("UTC")), JSON);
        String token = jwt.token();

        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        assertThat(token).doesNotContain("=").doesNotContain("+").doesNotContain("/");
        JsonNode header = part(token, 0);
        assertThat(header.get("alg").asString()).isEqualTo("ES256");
        assertThat(header.get("kid").asString()).isEqualTo("KEY0000001");
        assertThat(header.size()).isEqualTo(2);
        JsonNode claims = part(token, 1);
        assertThat(claims.get("iss").asString()).isEqualTo("TEAM000001");
        assertThat(claims.get("iat").asLong()).isEqualTo(NOW.getEpochSecond());
        assertThat(claims.size()).isEqualTo(2);

        // Raw R ‖ S of 64 bytes, as JWS wants, verified with the public key.
        byte[] signature = Base64.getUrlDecoder().decode(parts[2]);
        assertThat(signature).hasSize(64);
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(pair.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(verifier.verify(signature)).isTrue();

        // Another key does not verify it.
        Signature other = Signature.getInstance("SHA256withECDSAinP1363Format");
        other.initVerify(PushTestKeys.ecPair().getPublic());
        other.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(other.verify(signature)).isFalse();
    }

    @Test
    void theSameTokenServesFiftyMinutesThenANewOneIsSigned() {
        MovingClock clock = new MovingClock(NOW);
        ApnsJwt jwt = new ApnsJwt((ECPrivateKey) PushTestKeys.ecPair().getPrivate(), "KEY0000001", "TEAM000001", clock, JSON);
        String first = jwt.token();
        clock.now = NOW.plus(Duration.ofMinutes(49)).plusSeconds(59);
        assertThat(jwt.token()).isSameAs(first);
        clock.now = NOW.plus(Duration.ofMinutes(50));
        String second = jwt.token();
        assertThat(second).isNotEqualTo(first);
        assertThat(part(second, 1).get("iat").asLong()).isEqualTo(NOW.plus(Duration.ofMinutes(50)).getEpochSecond());
        clock.now = NOW.plus(Duration.ofMinutes(60));
        assertThat(jwt.token()).isSameAs(second);
    }
}
