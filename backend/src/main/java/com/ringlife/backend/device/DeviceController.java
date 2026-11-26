package com.ringlife.backend.device;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;

@RestController
@RequestMapping("/api/v1/devices")
class DeviceController {

    static final int MAX_FIELD_LENGTH = 100;

    record RegisterRequest(String hardwareId, String model, String firmware) {}

    record RegisterResponse(String deviceId, String token) {}

    private final DeviceService devices;
    private final String pairingSecret;

    DeviceController(DeviceService devices, @Value("${ringlife.pairing-secret:}") String pairingSecret) {
        this.devices = devices;
        this.pairingSecret = pairingSecret;
    }

    @PostMapping
    RegisterResponse register(
            @RequestHeader(value = "X-Pairing-Secret", required = false) String secret,
            @RequestBody RegisterRequest request) {
        if (pairingSecret.isBlank()) {
            // Senza segreto configurato la registrazione e' spenta: non si finge che esista.
            throw new ApiException(HttpStatus.NOT_FOUND, "Registrazione non disponibile");
        }
        if (secret == null || !sameSecret(secret, pairingSecret)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Segreto di registrazione non valido");
        }
        String hardwareId = required(request.hardwareId(), "hardwareId");
        String model = required(request.model(), "model");
        String firmware = request.firmware() == null ? null : limit(request.firmware(), "firmware");
        DeviceService.Registration registration = devices.register(hardwareId, model, firmware);
        return new RegisterResponse(registration.deviceId(), registration.token());
    }

    private static String required(String value, String name) {
        if (value == null || value.isBlank()) {
            throw ApiException.badRequest("Campo obbligatorio: " + name);
        }
        return limit(value.trim(), name);
    }

    private static String limit(String value, String name) {
        if (value.length() > MAX_FIELD_LENGTH) {
            throw ApiException.badRequest("Campo troppo lungo: " + name);
        }
        return value;
    }

    /** Confronto a tempo costante: non rivela quanti caratteri sono giusti. */
    private static boolean sameSecret(String given, String expected) {
        return MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
    }
}
