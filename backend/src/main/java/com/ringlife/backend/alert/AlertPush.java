package com.ringlife.backend.alert;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.ringlife.backend.alert.AlertCatalog.Settings;
import com.ringlife.backend.alert.AlertRepository.PendingPush;
import com.ringlife.backend.compute.ComputeSettings;
import com.ringlife.backend.push.ApnsSettings;
import com.ringlife.backend.push.PushRegistration;
import com.ringlife.backend.push.PushRegistrations;
import com.ringlife.backend.push.PushSender;
import com.ringlife.backend.push.PushSender.Message;
import com.ringlife.backend.push.PushSender.Outcome;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Pushes of the alerts (ADR 0047). A new event with delivery `notifica` or `importante`, on a registered device of a
 * server with the APNs key, waits as `pending` until its time: now, or after `deliverAfter` and after the quiet hours
 * (same rule as the app). Every minute {@link #sendDue()} sends the due ones, one push per device. Errors never reach
 * the evaluation or the scheduler, and the logs never carry a token, a key or a health value.
 */
@Service
public class AlertPush {

    private static final Logger LOG = LoggerFactory.getLogger(AlertPush.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    /** A push never goes out for an event created more than 3 days ago. */
    static final long MAX_AGE_MS = 3L * 24 * 60 * 60 * 1000;
    /** Network errors and Apple's 5xx and 429: tries per event before `failed`. */
    static final int MAX_ATTEMPTS = 3;
    /** Titles listed in the body of a grouped push. */
    static final int MAX_TITLES = 4;
    static final String LIST_PAGE = "/avvisi";

    /** The push state an event is born with and, for `pending`, when it is due (ms UTC). */
    record Plan(String state, Long dueAt) {}

    private final AlertRepository repository;
    private final PushRegistrations registrations;
    private final ApnsSettings apns;
    private final PushSender sender;
    private final ComputeSettings compute;
    private final Clock clock;
    private final ObjectMapper json;

    AlertPush(
            AlertRepository repository,
            PushRegistrations registrations,
            ApnsSettings apns,
            PushSender sender,
            ComputeSettings compute,
            Clock clock,
            ObjectMapper json) {
        this.repository = repository;
        this.registrations = registrations;
        this.apns = apns;
        this.sender = sender;
        this.compute = compute;
        this.clock = clock;
        this.json = json;
    }

    /** Whether the events of the device go out as pushes: key on the server and the phone registered. */
    boolean activeFor(String deviceId) {
        return apns.serverReady() && registrations.exists(deviceId);
    }

    /** The push of a new event: `pending` only with pushes on and a delivery that notifies; `none` otherwise. */
    Plan plan(boolean active, String delivery, Long deliverAfter, Settings settings, long now) {
        if (!active || AlertCatalog.LIST_ONLY.equals(delivery)) {
            return new Plan(AlertRepository.PUSH_NONE, null);
        }
        long at = deliverAfter != null && deliverAfter > now ? deliverAfter : now;
        return new Plan(AlertRepository.PUSH_PENDING, afterQuietHours(at, settings.quietStart(), settings.quietEnd(), compute.zone()));
    }

    /**
     * The first instant at or after `at` outside the quiet hours, which may cross midnight (22:30-07:00): inside them,
     * their end, today or tomorrow. Equal or invalid times mean no quiet hours. Mirrors `afterQuietHours` of the app.
     */
    static long afterQuietHours(long at, String quietStart, String quietEnd, ZoneId zone) {
        Integer start = minutes(quietStart);
        Integer end = minutes(quietEnd);
        if (start == null || end == null || start.equals(end)) {
            return at;
        }
        ZonedDateTime local = Instant.ofEpochMilli(at).atZone(zone);
        int now = local.getHour() * 60 + local.getMinute();
        boolean inside = start < end ? now >= start && now < end : now >= start || now < end;
        if (!inside) {
            return at;
        }
        LocalDateTime candidate = local.toLocalDate().atTime(LocalTime.of(end / 60, end % 60));
        long result = candidate.atZone(zone).toInstant().toEpochMilli();
        if (result <= at) {
            result = candidate.plusDays(1).atZone(zone).toInstant().toEpochMilli();
        }
        return result;
    }

    private static Integer minutes(String time) {
        if (time == null || !time.matches("([01]\\d|2[0-3]):[0-5]\\d")) {
            return null;
        }
        return Integer.parseInt(time.substring(0, 2)) * 60 + Integer.parseInt(time.substring(3));
    }

    // --- sending ---

    /** Sends the due pushes, one per device. Never throws. */
    public void sendDue() {
        try {
            if (!apns.serverReady()) {
                // Key removed from the server: what was waiting goes back to the phone's local notifications.
                repository.clearPendingPushes(null);
                return;
            }
            long now = clock.millis();
            Map<String, List<PendingPush>> byDevice = new LinkedHashMap<>();
            for (PendingPush push : repository.duePushes(now)) {
                byDevice.computeIfAbsent(push.deviceId(), d -> new ArrayList<>()).add(push);
            }
            byDevice.forEach((deviceId, events) -> {
                try {
                    send(deviceId, events, now);
                } catch (RuntimeException e) {
                    LOG.warn("Invio della push fallito: {}", e.getClass().getSimpleName());
                }
            });
        } catch (RuntimeException e) {
            LOG.warn("Giro delle push fallito: {}", e.getClass().getSimpleName());
        }
    }

    private void send(String deviceId, List<PendingPush> due, long now) {
        List<String> stale = new ArrayList<>();
        List<PendingPush> fresh = new ArrayList<>();
        for (PendingPush push : due) {
            if (push.createdAt() < now - MAX_AGE_MS) {
                stale.add(push.id());
            } else {
                fresh.add(push);
            }
        }
        if (!stale.isEmpty()) {
            repository.setPushState(stale, AlertRepository.PUSH_FAILED, null);
        }
        if (fresh.isEmpty()) {
            return;
        }
        Optional<PushRegistration> registration = registrations.find(deviceId);
        if (registration.isEmpty()) {
            repository.clearPendingPushes(deviceId);
            return;
        }
        Settings settings = repository.settings(deviceId).orElse(AlertCatalog.DEFAULT_SETTINGS);
        List<String> ids = fresh.stream().map(PendingPush::id).toList();
        Outcome outcome = sender.send(registration.get(), message(fresh, settings));
        switch (outcome.result()) {
            case SENT -> {
                repository.setPushState(ids, AlertRepository.PUSH_SENT, now);
                registrations.markSent(deviceId, now);
            }
            case INVALID_TOKEN -> {
                repository.setPushState(ids, AlertRepository.PUSH_FAILED, null);
                registrations.delete(deviceId);
                LOG.info("Token push non piu' valido (HTTP {}, {}): registrazione del telefono tolta.", outcome.status(), outcome.reason());
            }
            case REJECTED -> {
                repository.setPushState(ids, AlertRepository.PUSH_FAILED, null);
                registrations.markError(deviceId, outcome.reason());
                LOG.warn("Push rifiutata da Apple (HTTP {}, {}).", outcome.status(), outcome.reason());
            }
            case RETRY -> {
                repository.pushAttemptFailed(ids, MAX_ATTEMPTS);
                registrations.markError(deviceId, outcome.reason());
                LOG.warn("Push non consegnata, si riprova al giro dopo (HTTP {}, {}).", outcome.status(), outcome.reason());
            }
        }
    }

    /**
     * What one push says: one event says its title, text and page; several say «N avvisi» with their titles and open
     * the list. With the lock screen `generico` only «RingLife» and «Un nuovo avviso.» / «N nuovi avvisi.». `importante`
     * on any of them asks for the time-sensitive level.
     */
    Message message(List<PendingPush> events, Settings settings) {
        boolean generic = AlertCatalog.LOCK_GENERIC.equals(settings.lockScreen());
        boolean important = events.stream().anyMatch(e -> AlertCatalog.IMPORTANT.equals(delivery(e)));
        List<String> ids = events.stream().map(PendingPush::id).toList();
        int count = events.size();
        if (generic) {
            return new Message("RingLife", count == 1 ? "Un nuovo avviso." : count + " nuovi avvisi.", LIST_PAGE, ids, important);
        }
        if (count == 1) {
            PendingPush event = events.get(0);
            return new Message(event.title(), event.body(), event.route(), ids, important);
        }
        List<String> titles = new ArrayList<>(new LinkedHashSet<>(events.stream().map(PendingPush::title).toList()));
        StringBuilder body = new StringBuilder(String.join("; ", titles.subList(0, Math.min(MAX_TITLES, titles.size()))));
        if (titles.size() > MAX_TITLES) {
            body.append("; e altri ").append(titles.size() - MAX_TITLES);
        }
        return new Message(count + " avvisi", body.append('.').toString(), LIST_PAGE, ids, important);
    }

    /** The delivery the event was created with (stored with its values); `notifica` when missing. */
    private String delivery(PendingPush event) {
        try {
            Map<String, Object> values = json.readValue(event.valuesJson(), MAP);
            return values != null && values.get("delivery") instanceof String d ? d : AlertCatalog.NOTIFY;
        } catch (RuntimeException e) {
            return AlertCatalog.NOTIFY;
        }
    }
}
