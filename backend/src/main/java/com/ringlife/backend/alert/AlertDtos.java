package com.ringlife.backend.alert;

import java.util.List;
import java.util.Map;

import com.ringlife.backend.alert.AlertCatalog.DaysRange;
import com.ringlife.backend.alert.AlertCatalog.Settings;

/** Bodies of the alerts API (ADR 0045, 0046, 0047, docs/api.md). Instants in milliseconds since the epoch, UTC. */
public final class AlertDtos {

    private AlertDtos() {}

    /** Allowed threshold: numbers are integers when they have no decimals (70, not 70.0). */
    record ThresholdView(String unit, Number min, Number max, Number step) {}

    record ParamsView(boolean sensitivity, DaysRange days, ThresholdView threshold) {}

    /** A rule with its description, its parameters and the values in use. Parameters the rule has not are null. */
    record RuleView(
            String id,
            String name,
            String description,
            String level,
            boolean usesAverage,
            ParamsView params,
            boolean enabled,
            String sensitivity,
            Integer days,
            Number threshold,
            String delivery) {}

    /** Allowed values of a measure, in its unit: integers when they have no decimals. */
    record ValueView(Number min, Number max, Number step) {}

    /** A measure your own rules can watch (ADR 0046). `unit` and `value` are null when only your average makes sense. */
    record MetricView(String id, String name, String unit, boolean night, boolean average, ValueView value) {}

    /** A rule of yours, with the name the server writes from it. `amount`: N deviations, or the value in its unit. */
    record CustomRuleView(
            String id,
            String name,
            String metric,
            String comparison,
            Number amount,
            int days,
            String level,
            String delivery,
            boolean enabled) {}

    /** `custom`: your rules, oldest first; `metrics`: the measures they can watch; `maxCustom`: at most this many. */
    public record ConfigView(
            Settings settings, List<RuleView> rules, List<CustomRuleView> custom, List<MetricView> metrics, int maxCustom) {}

    /** Creation: every field but `delivery` and `enabled` is required. Change: absent (null) fields stay as they are. */
    record CustomRequest(
            String metric, String comparison, Double amount, Integer days, String level, String delivery, Boolean enabled) {}

    /** Absent (null) fields stay as they are. */
    record SettingsUpdate(String quietStart, String quietEnd, String lockScreen, Boolean homeAssistant) {}

    /** Absent (null) fields stay as they are. */
    record RuleUpdate(Boolean enabled, String sensitivity, Integer days, Double threshold, String delivery) {}

    record UpdateRequest(SettingsUpdate settings, Map<String, RuleUpdate> rules) {}

    /** `push`: `none` (no push or delivery `elenco`), `pending`, `sent` or `failed` (ADR 0047). */
    record EventView(
            String id,
            String rule,
            String day,
            String level,
            String title,
            String body,
            String route,
            long createdAt,
            Long deliverAfter,
            Long seenAt,
            String push) {}

    public record EventsView(List<EventView> events, int unseen) {}

    /** `ids` of the events to mark as seen, or `all: true`. */
    record SeenRequest(List<String> ids, Boolean all) {}

    /** How many events changed to seen, and how many are still unseen. */
    public record SeenView(int marked, int unseen) {}
}
