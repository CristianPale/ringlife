package com.ringlife.backend.push;

import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

/** Keys made at runtime for the tests: no key is ever committed. */
final class PushTestKeys {

    private PushTestKeys() {}

    /** A fresh EC P-256 pair, like the one behind an APNs `.p8` file. */
    static KeyPair ecPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            return generator.generateKeyPair();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The private key as a `.p8` file looks: PEM with 64-character lines. */
    static String pem(KeyPair pair) {
        String body = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(pair.getPrivate().getEncoded());
        return "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n"; // gitleaks:allow (key made in the test)
    }

    /** The bare base64 body on one line. */
    static String oneLine(KeyPair pair) {
        return Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded());
    }
}
