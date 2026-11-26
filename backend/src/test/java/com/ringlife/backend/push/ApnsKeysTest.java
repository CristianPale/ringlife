package com.ringlife.backend.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.KeyPair;

import org.junit.jupiter.api.Test;

/** The `.p8` key in the forms the configuration accepts (ADR 0047), always made at runtime. */
class ApnsKeysTest {

    @Test
    void theFullPemAndTheBareBodyOnOneLineGiveTheSameKey() {
        KeyPair pair = PushTestKeys.ecPair();
        byte[] expected = pair.getPrivate().getEncoded();
        assertThat(ApnsKeys.parse(PushTestKeys.pem(pair)).getEncoded()).isEqualTo(expected);
        assertThat(ApnsKeys.parse(PushTestKeys.oneLine(pair)).getEncoded()).isEqualTo(expected);
        // Windows line ends, spaces, and the «\n» an option field may keep as two characters.
        assertThat(ApnsKeys.parse(PushTestKeys.pem(pair).replace("\n", "\r\n")).getEncoded()).isEqualTo(expected);
        assertThat(ApnsKeys.parse("  " + PushTestKeys.pem(pair).replace("\n", "\\n") + "  ").getEncoded()).isEqualTo(expected);
        String body = PushTestKeys.oneLine(pair);
        assertThat(ApnsKeys.parse(body.substring(0, 20) + " \n " + body.substring(20)).getEncoded()).isEqualTo(expected);
    }

    @Test
    void somethingElseIsRefusedWithoutRepeatingIt() {
        String body = PushTestKeys.oneLine(PushTestKeys.ecPair());
        String broken = body.substring(0, body.length() - 8);
        assertThatThrownBy(() -> ApnsKeys.parse(broken))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Chiave APNs non valida: serve il contenuto del file .p8");
        assertThatThrownBy(() -> ApnsKeys.parse("non una chiave")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApnsKeys.parse(" ")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void thePushesAreOnOnlyWithKeyKeyIdAndTeam() {
        String pem = PushTestKeys.pem(PushTestKeys.ecPair());
        assertThat(new ApnsSettings(pem, "KEY0000001", "TEAM000001", "com.ringlife.app", "").serverReady()).isTrue();
        assertThat(new ApnsSettings(PushTestKeys.oneLine(PushTestKeys.ecPair()), "KEY0000001", "TEAM000001", "", "").serverReady()).isTrue();
        assertThat(new ApnsSettings("", "KEY0000001", "TEAM000001", "com.ringlife.app", "").serverReady()).isFalse();
        assertThat(new ApnsSettings(pem, "", "TEAM000001", "com.ringlife.app", "").serverReady()).isFalse();
        assertThat(new ApnsSettings(pem, "KEY0000001", " ", "com.ringlife.app", "").serverReady()).isFalse();
        assertThat(new ApnsSettings("rotta", "KEY0000001", "TEAM000001", "com.ringlife.app", "").serverReady()).isFalse();
    }

    @Test
    void appleHostsFollowTheEnvironmentUnlessOverridden() {
        String pem = PushTestKeys.pem(PushTestKeys.ecPair());
        ApnsSettings settings = new ApnsSettings(pem, "KEY0000001", "TEAM000001", "", "");
        assertThat(settings.baseUrl("production")).isEqualTo("https://api.push.apple.com");
        assertThat(settings.baseUrl("sandbox")).isEqualTo("https://api.sandbox.push.apple.com");
        assertThat(settings.topic()).isEqualTo("com.ringlife.app");
        assertThat(new ApnsSettings(pem, "K", "T", "com.example", "http://127.0.0.1:9/").baseUrl("sandbox")).isEqualTo("http://127.0.0.1:9");
    }
}
