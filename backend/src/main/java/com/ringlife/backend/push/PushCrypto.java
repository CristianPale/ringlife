package com.ringlife.backend.push;

import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The encryption of the push text (ADR 0047): AES-256-GCM with a random 12-byte nonce, a 16-byte tag and no associated
 * data. The result is base64 of nonce ‖ ciphertext ‖ tag, the «combined» layout of CryptoKit that the notification
 * extension opens on the phone.
 */
public final class PushCrypto {

    static final int KEY_BYTES = 32;
    static final int NONCE_BYTES = 12;
    static final int TAG_BITS = 128;

    private static final SecureRandom RANDOM = new SecureRandom();

    private PushCrypto() {}

    /** Encrypts `plaintext` with the 32-byte key of the device. */
    public static String seal(byte[] key, byte[] plaintext) {
        if (key == null || key.length != KEY_BYTES) {
            throw new IllegalArgumentException("Chiave del dispositivo non valida");
        }
        byte[] nonce = new byte[NONCE_BYTES];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_BITS, nonce));
            // Java appends the tag to the ciphertext: nonce ‖ ciphertext ‖ tag is the combined layout.
            byte[] sealed = cipher.doFinal(plaintext);
            byte[] combined = new byte[NONCE_BYTES + sealed.length];
            System.arraycopy(nonce, 0, combined, 0, NONCE_BYTES);
            System.arraycopy(sealed, 0, combined, NONCE_BYTES, sealed.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cifratura della push fallita", e);
        }
    }
}
