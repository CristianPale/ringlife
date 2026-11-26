package com.ringlife.backend.push;

import java.util.List;

/** Sends one push to a registered phone (ADR 0047). Never throws: every failure is an {@link Outcome}. */
public interface PushSender {

    /**
     * What the push says, encrypted: title, body, the app page to open and the events it covers. `timeSensitive` asks
     * iOS for the «time-sensitive» interruption level (delivery `importante`).
     */
    record Message(String title, String body, String route, List<String> ids, boolean timeSensitive) {}

    /** How Apple answered. */
    enum Result {
        /** 200: delivered to Apple. */
        SENT,
        /** 410, or 400 with a reason saying the token is no longer valid: the registration must go. */
        INVALID_TOKEN,
        /** Another 4xx: Apple refused this push, retrying does not help. */
        REJECTED,
        /** 5xx, 429 or a network error: retry on the next round. */
        RETRY
    }

    /** `status` is the HTTP status (0 without an answer), `reason` Apple's reason or a short description. */
    record Outcome(Result result, int status, String reason) {}

    Outcome send(PushRegistration registration, Message message);
}
