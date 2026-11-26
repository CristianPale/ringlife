package com.ringlife.backend.push;

/**
 * A phone registered for pushes (ADR 0047): APNs token (hexadecimal), 256-bit AES key in base64 and Apple's environment.
 * Token and key never go in a log or an error message; `toString` leaves them out.
 */
public record PushRegistration(
        String deviceId,
        String token,
        String key,
        String environment,
        long createdAt,
        long updatedAt,
        Long lastSentAt,
        String lastError) {

    @Override
    public String toString() {
        return "PushRegistration[deviceId=" + deviceId + ", environment=" + environment + "]";
    }
}
