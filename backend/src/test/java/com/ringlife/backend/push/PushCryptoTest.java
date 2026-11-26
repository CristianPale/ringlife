package com.ringlife.backend.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Test;

/** AES-256-GCM of the push text (ADR 0047), opened here as CryptoKit opens the «combined» layout on the phone. */
class PushCryptoTest {

    private static byte[] key() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return key;
    }

    /** nonce (12) ‖ ciphertext ‖ tag (16), no associated data. */
    static byte[] open(byte[] key, String sealed) throws Exception {
        byte[] combined = Base64.getDecoder().decode(sealed);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, Arrays.copyOfRange(combined, 0, 12)));
        return cipher.doFinal(combined, 12, combined.length - 12);
    }

    @Test
    void theTextComesBackWithTheSameKeyInTheCombinedLayout() throws Exception {
        byte[] key = key();
        byte[] plaintext = "{\"title\":\"Passi sotto 3.000\",\"ids\":[\"e1\"]}".getBytes(StandardCharsets.UTF_8);
        String sealed = PushCrypto.seal(key, plaintext);
        assertThat(Base64.getDecoder().decode(sealed)).hasSize(12 + plaintext.length + 16);
        assertThat(open(key, sealed)).isEqualTo(plaintext);
        assertThat(new String(Base64.getDecoder().decode(sealed), StandardCharsets.ISO_8859_1)).doesNotContain("Passi");
    }

    @Test
    void everyPushHasItsOwnNonce() {
        byte[] key = key();
        byte[] plaintext = "stesso testo".getBytes(StandardCharsets.UTF_8);
        String first = PushCrypto.seal(key, plaintext);
        String second = PushCrypto.seal(key, plaintext);
        assertThat(first).isNotEqualTo(second);
        assertThat(Arrays.copyOf(Base64.getDecoder().decode(first), 12)).isNotEqualTo(Arrays.copyOf(Base64.getDecoder().decode(second), 12));
    }

    @Test
    void anotherKeyOrATouchedTextDoesNotOpen() {
        byte[] key = key();
        String sealed = PushCrypto.seal(key, "testo".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> open(key(), sealed)).isInstanceOf(AEADBadTagException.class);
        byte[] touched = Base64.getDecoder().decode(sealed);
        touched[touched.length - 1] ^= 1;
        assertThatThrownBy(() -> open(key, Base64.getEncoder().encodeToString(touched))).isInstanceOf(AEADBadTagException.class);
    }

    @Test
    void onlyA256BitKeyIsAccepted() {
        assertThatThrownBy(() -> PushCrypto.seal(new byte[16], new byte[1])).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PushCrypto.seal(null, new byte[1])).isInstanceOf(IllegalArgumentException.class);
    }
}
