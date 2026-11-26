package com.ringlife.backend.alert;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The round of the pushes (ADR 0047): every minute, the due ones. Off with `ringlife.apns.scheduler=false` (tests call
 * {@link AlertPush#sendDue()} themselves). Without the APNs key a round only gives the waiting events back to the phone.
 */
@Component
@ConditionalOnProperty(name = "ringlife.apns.scheduler", havingValue = "true", matchIfMissing = true)
class AlertPushScheduler {

    private final AlertPush push;

    AlertPushScheduler(AlertPush push) {
        this.push = push;
    }

    @Scheduled(fixedDelayString = "${ringlife.apns.interval-ms:60000}", initialDelayString = "${ringlife.apns.interval-ms:60000}")
    void round() {
        push.sendDue();
    }
}
