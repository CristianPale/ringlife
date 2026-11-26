package com.ringlife.backend.push;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;

/**
 * The APNs signing key (ADR 0047): the content of the `.p8` file Apple gives, a PKCS#8 EC private key on P-256. Accepted
 * as the full PEM or as the bare base64 body, also on one line; whitespace and literal «\n» are ignored. The key never
 * appears in a message or a log.
 */
public final class ApnsKeys {

    private ApnsKeys() {}

    /** The private key, or an exception without the key content when the text is not a PKCS#8 EC key. */
    public static ECPrivateKey parse(String text) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("Chiave APNs assente");
        }
        String body = text
                .replace("\\n", "")
                .replaceAll("-----(BEGIN|END)[A-Z ]*-----", "")
                .replaceAll("\\s+", "");
        try {
            byte[] der = Base64.getDecoder().decode(body);
            if (KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der)) instanceof ECPrivateKey key) {
                return key;
            }
        } catch (IllegalArgumentException | GeneralSecurityException e) {
            // Below: the message never carries the key.
        }
        throw new IllegalArgumentException("Chiave APNs non valida: serve il contenuto del file .p8");
    }
}
