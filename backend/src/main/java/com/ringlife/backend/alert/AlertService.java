package com.ringlife.backend.alert;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.ringlife.backend.alert.AlertCatalog.Definition;
import com.ringlife.backend.alert.AlertCatalog.RuleConfig;
import com.ringlife.backend.alert.AlertCatalog.Settings;
import com.ringlife.backend.alert.AlertCatalog.ThresholdRange;
import com.ringlife.backend.alert.AlertDtos.ConfigView;
import com.ringlife.backend.alert.AlertDtos.CustomRequest;
import com.ringlife.backend.alert.AlertDtos.CustomRuleView;
import com.ringlife.backend.alert.AlertDtos.EventView;
import com.ringlife.backend.alert.AlertDtos.EventsView;
import com.ringlife.backend.alert.AlertDtos.MetricView;
import com.ringlife.backend.alert.AlertDtos.ParamsView;
import com.ringlife.backend.alert.AlertDtos.RuleUpdate;
import com.ringlife.backend.alert.AlertDtos.RuleView;
import com.ringlife.backend.alert.AlertDtos.SeenRequest;
import com.ringlife.backend.alert.AlertDtos.SeenView;
import com.ringlife.backend.alert.AlertDtos.SettingsUpdate;
import com.ringlife.backend.alert.AlertDtos.ThresholdView;
import com.ringlife.backend.alert.AlertDtos.UpdateRequest;
import com.ringlife.backend.alert.AlertDtos.ValueView;
import com.ringlife.backend.alert.AlertRepository.EventRow;
import com.ringlife.backend.alert.AlertRepository.RuleRow;
import com.ringlife.backend.alert.CustomCatalog.Metric;
import com.ringlife.backend.alert.CustomCatalog.Rule;
import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.compute.ComputeSettings;
import com.ringlife.backend.compute.DailyComputationService;
import com.ringlife.backend.compute.FinishedNights;
import com.ringlife.backend.compute.History;
import com.ringlife.backend.compute.History.DayResults;
import com.ringlife.backend.plugin.PluginResult;
import com.ringlife.backend.plugin.PluginService;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * The alert engine (ADR 0045), next to the plugins: configuration per device, evaluation of the built-in rules and of
 * your own rules (ADR 0046) after each upload and every night, events (at most one per rule and day, never rewritten,
 * born with their push state, ADR 0047) and the summary for Home Assistant. Evaluation never throws, and the logs never
 * carry a health value.
 */
@Service
public class AlertService {

    private static final Logger LOG = LoggerFactory.getLogger(AlertService.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    /** Days evaluated at most, today included: older days stay as they were. Same window as the default event list. */
    static final int MAX_EVALUATED_DAYS = 30;
    /** Days loaded before the first evaluated day, to count the nights in a row. */
    static final int STREAK_LOOKBACK_DAYS = 28;
    /** Events listed without `since`: the last 30 days. */
    static final int DEFAULT_WINDOW_DAYS = 30;
    static final int MAX_EVENTS = 200;
    static final int MAX_SEEN_IDS = 500;
    private static final long DAY_MS = 24L * 60 * 60 * 1000;
    private static final String TIME = "([01]\\d|2[0-3]):[0-5]\\d";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** What Home Assistant shows: unseen events and title, level and day of the latest one (null without events). */
    public record HaSummary(int unseen, String title, String level, String day) {}

    private final AlertRepository repository;
    private final History history;
    private final PluginService plugins;
    private final FinishedNights nights;
    private final DailyComputationService computation;
    private final ComputeSettings settings;
    private final TransactionTemplate transaction;
    private final AlertPush push;
    private final Clock clock;
    private final ObjectMapper json;

    AlertService(
            AlertRepository repository,
            History history,
            PluginService plugins,
            FinishedNights nights,
            DailyComputationService computation,
            ComputeSettings settings,
            TransactionTemplate transaction,
            AlertPush push,
            Clock clock,
            ObjectMapper json) {
        this.repository = repository;
        this.history = history;
        this.plugins = plugins;
        this.nights = nights;
        this.computation = computation;
        this.settings = settings;
        this.transaction = transaction;
        this.push = push;
        this.clock = clock;
        this.json = json;
    }

    // --- configuration ---

    ConfigView config(String deviceId) {
        Map<String, RuleConfig> rules = rules(deviceId);
        return new ConfigView(
                settingsOf(deviceId),
                AlertCatalog.ALL.stream().map(rule -> view(rule, rules.get(rule.id()))).toList(),
                repository.customRules(deviceId).stream()
                        .filter(rule -> CustomCatalog.metric(rule.metric()).isPresent())
                        .map(AlertService::view)
                        .toList(),
                CustomCatalog.METRICS.stream().map(AlertService::view).toList(),
                CustomCatalog.MAX_RULES);
    }

    /**
     * Changes only the fields present in the request; 400 for an unknown rule, a parameter the rule has not or a value
     * out of range, and then nothing is written. Today is evaluated again with the new configuration.
     */
    ConfigView update(String deviceId, UpdateRequest request) {
        if (request == null) {
            throw ApiException.badRequest("Corpo della richiesta non valido");
        }
        Settings nextSettings = request.settings() == null ? null : apply(settingsOf(deviceId), request.settings());

        Map<String, RuleRow> stored = repository.rules(deviceId);
        Map<String, RuleConfig> current = rules(deviceId);
        Map<String, RuleRow> writes = new LinkedHashMap<>();
        if (request.rules() != null) {
            for (Map.Entry<String, RuleUpdate> entry : request.rules().entrySet()) {
                Definition rule = AlertCatalog.byId(entry.getKey()).orElseThrow(() -> ApiException.badRequest("Regola sconosciuta"));
                RuleUpdate change = entry.getValue();
                if (change == null) {
                    continue;
                }
                Map<String, Object> chosen = new LinkedHashMap<>(chosen(stored.get(rule.id())));
                apply(rule, change, chosen);
                boolean enabled = change.enabled() != null ? change.enabled() : current.get(rule.id()).enabled();
                writes.put(rule.id(), new RuleRow(enabled, json.writeValueAsString(chosen)));
            }
        }

        long now = clock.millis();
        transaction.executeWithoutResult(status -> {
            if (nextSettings != null) {
                repository.saveSettings(deviceId, nextSettings, now);
            }
            writes.forEach((ruleId, row) -> repository.saveRule(deviceId, ruleId, row.enabled(), row.config(), now));
        });
        if (!writes.isEmpty()) {
            evaluateToday(deviceId);
        }
        return config(deviceId);
    }

    // --- your own rules (ADR 0046) ---

    /** Creates a rule of yours; 400 for a missing or invalid field or the 21st rule, and then nothing is written. */
    ConfigView createCustom(String deviceId, CustomRequest request) {
        if (request == null) {
            throw ApiException.badRequest("Corpo della richiesta non valido");
        }
        Rule rule = validated(new Rule(
                CustomCatalog.ID_PREFIX + HexFormat.of().formatHex(randomBytes(4)),
                required(request.metric(), "metric"),
                required(request.comparison(), "comparison"),
                required(request.amount(), "amount"),
                required(request.days(), "days"),
                required(request.level(), "level"),
                request.delivery() != null ? request.delivery() : AlertCatalog.NOTIFY,
                request.enabled() == null || request.enabled()));
        long now = clock.millis();
        transaction.executeWithoutResult(status -> {
            if (repository.countCustomRules(deviceId) >= CustomCatalog.MAX_RULES) {
                throw ApiException.badRequest("Al massimo " + CustomCatalog.MAX_RULES + " avvisi tuoi");
            }
            // Strictly after the previous rule: the list keeps the order of creation even within one millisecond.
            repository.insertCustomRule(deviceId, rule, Math.max(now, repository.lastCustomCreatedAt(deviceId) + 1));
        });
        evaluateAfterCustomChange(deviceId);
        return config(deviceId);
    }

    /** Changes the fields present; 404 for a rule that is not there, 400 as for the creation. */
    ConfigView updateCustom(String deviceId, String ruleId, CustomRequest request) {
        if (request == null) {
            throw ApiException.badRequest("Corpo della richiesta non valido");
        }
        Rule current = repository.customRule(deviceId, ruleId).orElseThrow(AlertService::unknownCustomRule);
        Rule rule = validated(new Rule(
                current.id(),
                request.metric() != null ? request.metric() : current.metric(),
                request.comparison() != null ? request.comparison() : current.comparison(),
                request.amount() != null ? request.amount() : current.amount(),
                request.days() != null ? request.days() : current.days(),
                request.level() != null ? request.level() : current.level(),
                request.delivery() != null ? request.delivery() : current.delivery(),
                request.enabled() != null ? request.enabled() : current.enabled()));
        repository.updateCustomRule(deviceId, rule, clock.millis());
        evaluateAfterCustomChange(deviceId);
        return config(deviceId);
    }

    /** Removes a rule of yours; the events it created stay. 404 for a rule that is not there. */
    ConfigView deleteCustom(String deviceId, String ruleId) {
        if (!repository.deleteCustomRule(deviceId, ruleId)) {
            throw unknownCustomRule();
        }
        return config(deviceId);
    }

    private static ApiException unknownCustomRule() {
        return new ApiException(HttpStatus.NOT_FOUND, "Regola sconosciuta");
    }

    /** The whole rule against the catalogue: a change of measure must still fit its comparison and amount. */
    private static Rule validated(Rule rule) {
        Metric metric = CustomCatalog.metric(rule.metric()).orElseThrow(() -> ApiException.badRequest("Parametro non valido: metric"));
        if (!CustomCatalog.COMPARISONS.contains(rule.comparison()) || !metric.allows(rule.comparison())) {
            throw ApiException.badRequest("Parametro non valido: comparison");
        }
        CustomCatalog.ValueRange range = CustomCatalog.withAverage(rule.comparison()) ? CustomCatalog.DEVIATIONS : metric.value();
        if (!range.accepts(rule.amount())) {
            throw ApiException.badRequest("Parametro non valido: amount");
        }
        if (rule.days() < CustomCatalog.DAYS.min() || rule.days() > CustomCatalog.DAYS.max()) {
            throw ApiException.badRequest("Parametro non valido: days");
        }
        if (!CustomCatalog.LEVELS.contains(rule.level())) {
            throw ApiException.badRequest("Parametro non valido: level");
        }
        if (!AlertCatalog.DELIVERIES.contains(rule.delivery())) {
            throw ApiException.badRequest("Parametro non valido: delivery");
        }
        return rule;
    }

    private static <T> T required(T value, String field) {
        if (value == null || (value instanceof String text && text.isBlank())) {
            throw ApiException.badRequest("Campo obbligatorio: " + field);
        }
        return value;
    }

    private static byte[] randomBytes(int count) {
        byte[] bytes = new byte[count];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    /**
     * After a change of your rules, like after a change of the built-in ones: today for the night measures, yesterday
     * for the measures of a whole day (today never counts for them).
     */
    private void evaluateAfterCustomChange(String deviceId) {
        LocalDate today = computation.today();
        evaluate(deviceId, today.minusDays(1), false, rule -> CustomCatalog.metric(rule.metric()).map(m -> !m.night()).orElse(false));
        evaluate(deviceId, today, false, rule -> true);
    }

    /** Whether the device publishes its alerts in Home Assistant (`settings.homeAssistant`). */
    public boolean publishesToHomeAssistant(String deviceId) {
        return settingsOf(deviceId).homeAssistant();
    }

    /** The summary for `sensor.ringlife_alerts`; empty when the device does not publish its alerts in Home Assistant. */
    public Optional<HaSummary> homeAssistantSummary(String deviceId) {
        if (!publishesToHomeAssistant(deviceId)) {
            return Optional.empty();
        }
        Optional<EventRow> latest = repository.latest(deviceId);
        return Optional.of(new HaSummary(
                repository.unseen(deviceId),
                latest.map(EventRow::title).orElse(null),
                latest.map(EventRow::level).orElse(null),
                latest.map(EventRow::day).orElse(null)));
    }

    // --- evaluation ---

    /**
     * Evaluates the rules that are on for the days from `from` to today (at most the last 30 days), after the daily
     * computation and the plugins. An existing event for a rule and day is never rewritten. Never throws.
     *
     * <p>The rules on last night (`Definition.lastNight`) skip a day whose night is not over yet, or that has no sleep
     * session ({@link FinishedNights}): a night read at 03:00 would otherwise fix an event on half a night. When a
     * later upload completes the night, the next evaluation creates the event as usual.
     */
    public void evaluateFrom(String deviceId, LocalDate from) {
        evaluate(deviceId, from, true, rule -> true);
    }

    /** What every new event of one evaluation needs: general settings, whether pushes are on, the time. */
    private record Context(Settings settings, boolean pushActive, long now) {}

    /**
     * Evaluates the built-in rules that are on (`builtIns`) and your rules that are on and pass `customs`, for the days
     * from `from` to today, at most the last 30. Your rules on a night measure wait for the night like the built-in
     * `lastNight` rules; those on a whole day never look at today. Never throws.
     */
    private void evaluate(String deviceId, LocalDate from, boolean builtIns, Predicate<Rule> customs) {
        try {
            LocalDate today = computation.today();
            LocalDate first = from.isAfter(today) ? today : from;
            LocalDate earliest = today.minusDays(MAX_EVALUATED_DAYS - 1L);
            if (first.isBefore(earliest)) {
                first = earliest;
            }
            Map<String, RuleConfig> rules = rules(deviceId);
            List<Definition> active = builtIns
                    ? AlertCatalog.ALL.stream().filter(rule -> rules.get(rule.id()).enabled()).toList()
                    : List.of();
            List<Rule> mine = repository.customRules(deviceId).stream()
                    .filter(Rule::enabled)
                    .filter(rule -> CustomCatalog.metric(rule.metric()).isPresent())
                    .filter(customs)
                    .toList();
            if (active.isEmpty() && mine.isEmpty()) {
                return;
            }
            Map<LocalDate, DayResults> byDay = new HashMap<>();
            for (DayResults results : history.days(deviceId, first.minusDays(STREAK_LOOKBACK_DAYS), today)) {
                byDay.put(results.day(), results);
            }
            Context context = new Context(settingsOf(deviceId), push.activeFor(deviceId), clock.millis());
            boolean anyOnLastNight = active.stream().anyMatch(Definition::lastNight)
                    || mine.stream().anyMatch(rule -> CustomCatalog.metric(rule.metric()).orElseThrow().night());
            for (LocalDate day = first; !day.isAfter(today); day = day.plusDays(1)) {
                boolean nightOver = anyOnLastNight && nights.isFinished(deviceId, day);
                for (Definition rule : active) {
                    if (rule.lastNight() && !nightOver) {
                        continue;
                    }
                    evaluate(deviceId, rule, rules.get(rule.id()), day, byDay::get, today, context);
                }
                for (Rule rule : mine) {
                    if (CustomCatalog.metric(rule.metric()).orElseThrow().night() && !nightOver) {
                        continue;
                    }
                    evaluateCustom(deviceId, rule, day, byDay::get, today, context);
                }
            }
        } catch (RuntimeException e) {
            // Only the type: the message could carry values.
            LOG.warn("Valutazione degli avvisi fallita: {}", e.getClass().getSimpleName());
        }
    }

    /** Evaluates today only: after a diary sync or a configuration change. Never throws. */
    public void evaluateToday(String deviceId) {
        evaluateFrom(deviceId, computation.today());
    }

    /** Nightly job: the last `days` days of every device. */
    public void evaluateRecent(int days) {
        LocalDate from = computation.today().minusDays(days - 1L);
        for (String deviceId : repository.deviceIds()) {
            evaluateFrom(deviceId, from);
        }
    }

    private void evaluate(
            String deviceId, Definition rule, RuleConfig config, LocalDate day, AlertRules.Days days, LocalDate today, Context context) {
        try {
            if (rule.pluginId() != null) {
                // Rules fed by a plugin: its alerts are read only while the plugin is on.
                plugins.alerts(deviceId, rule.pluginId(), day).stream()
                        .filter(alert -> rule.id().equals(alert.rule()))
                        .findFirst()
                        .ifPresent(alert -> insert(deviceId, rule.id(), rule.version(), rule.level(), rule.route(), config.delivery(),
                                day, fromPlugin(alert), context));
                return;
            }
            AlertRules.evaluate(rule, config, day, days, today, settings.zone()).ifPresent(draft -> insert(
                    deviceId, rule.id(), rule.version(), rule.level(), rule.route(), config.delivery(), day, draft, context));
        } catch (RuntimeException e) {
            LOG.warn("Regola di avviso {} fallita: {}", rule.id(), e.getClass().getSimpleName());
        }
    }

    private void evaluateCustom(String deviceId, Rule rule, LocalDate day, AlertRules.Days days, LocalDate today, Context context) {
        try {
            Metric metric = CustomCatalog.metric(rule.metric()).orElseThrow();
            CustomRules.evaluate(rule, day, days, today).ifPresent(draft -> insert(
                    deviceId, rule.id(), CustomRules.VERSION, rule.level(), metric.route(), rule.delivery(), day, draft, context));
        } catch (RuntimeException e) {
            LOG.warn("Regola di avviso {} fallita: {}", rule.id(), e.getClass().getSimpleName());
        }
    }

    private static AlertRules.Draft fromPlugin(PluginResult.Alert alert) {
        return new AlertRules.Draft(alert.title(), alert.body(), alert.values(), null);
    }

    /**
     * Writes the event unless the rule already has one that day. The delivery chosen at that moment goes with its values:
     * the push round reads it for the time-sensitive level. The push state follows {@link AlertPush#plan}.
     */
    private void insert(
            String deviceId, String ruleId, String version, String level, String route, String delivery, LocalDate day,
            AlertRules.Draft draft, Context context) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("ruleVersion", version);
        values.put("delivery", delivery);
        values.putAll(draft.values());
        AlertPush.Plan plan = push.plan(context.pushActive(), delivery, draft.deliverAfter(), context.settings(), context.now());
        repository.insertIfAbsent(deviceId, new EventRow(
                UUID.randomUUID().toString(), ruleId, day.toString(), level, draft.title(), draft.body(), route,
                json.writeValueAsString(values), context.now(), draft.deliverAfter(), null, plan.state(), plan.dueAt()));
    }

    /**
     * Purge (ADR 0021): deletes the events, of every device, of the local days that have at least one instant before
     * `beforeMs`, the days whose raw data the purge removes. The evaluation after the recomputation recreates what the
     * remaining data still supports. Returns how many events were deleted.
     */
    public int deleteEventsBefore(long beforeMs) {
        LocalDate lastDay = computation.dayOf(beforeMs - 1);
        return repository.deleteEventsUpTo(lastDay);
    }

    // --- events ---

    /** Events created since `since` (ms), or in the last 30 days; the most recent day first. */
    EventsView events(String deviceId, Long since) {
        if (since != null && since < 0) {
            throw ApiException.badRequest("Parametro non valido: since");
        }
        long from = since != null ? since : clock.millis() - DEFAULT_WINDOW_DAYS * DAY_MS;
        List<EventView> events = repository.events(deviceId, from, MAX_EVENTS).stream()
                .map(e -> new EventView(
                        e.id(), e.rule(), e.day(), e.level(), e.title(), e.body(), e.route(), e.createdAt(), e.deliverAfter(), e.seenAt(),
                        e.pushState()))
                .toList();
        return new EventsView(events, repository.unseen(deviceId));
    }

    /** Marks events as seen: the given ids of this device, or all. Unknown ids are ignored. */
    SeenView markSeen(String deviceId, SeenRequest request) {
        boolean all = request != null && Boolean.TRUE.equals(request.all());
        List<String> ids = request == null || request.ids() == null ? List.of() : request.ids();
        if (!all && ids.isEmpty()) {
            throw ApiException.badRequest("Campo obbligatorio: ids oppure all");
        }
        if (ids.size() > MAX_SEEN_IDS) {
            throw ApiException.badRequest("Troppi elementi nella richiesta");
        }
        if (ids.stream().anyMatch(id -> id == null || id.isBlank() || id.length() > 64)) {
            throw ApiException.badRequest("Identificativo non valido");
        }
        long now = clock.millis();
        int marked = all ? repository.markAllSeen(deviceId, now) : repository.markSeen(deviceId, ids.stream().distinct().toList(), now);
        return new SeenView(marked, repository.unseen(deviceId));
    }

    // --- configuration helpers ---

    private Settings settingsOf(String deviceId) {
        return repository.settings(deviceId).orElse(AlertCatalog.DEFAULT_SETTINGS);
    }

    private static Settings apply(Settings current, SettingsUpdate change) {
        String quietStart = current.quietStart();
        String quietEnd = current.quietEnd();
        String lockScreen = current.lockScreen();
        boolean homeAssistant = current.homeAssistant();
        if (change.quietStart() != null) {
            quietStart = time(change.quietStart(), "quietStart");
        }
        if (change.quietEnd() != null) {
            quietEnd = time(change.quietEnd(), "quietEnd");
        }
        if (change.lockScreen() != null) {
            if (!AlertCatalog.LOCK_SCREENS.contains(change.lockScreen())) {
                throw ApiException.badRequest("Parametro non valido: lockScreen");
            }
            lockScreen = change.lockScreen();
        }
        if (change.homeAssistant() != null) {
            homeAssistant = change.homeAssistant();
        }
        return new Settings(quietStart, quietEnd, lockScreen, homeAssistant);
    }

    private static String time(String value, String key) {
        if (!value.matches(TIME)) {
            throw ApiException.badRequest("Parametro non valido: " + key);
        }
        return value;
    }

    /** Validates the fields present in `change` against the rule and puts them in `chosen`. */
    private static void apply(Definition rule, RuleUpdate change, Map<String, Object> chosen) {
        String prefix = rule.id() + ".";
        if (change.sensitivity() != null) {
            if (!rule.params().sensitivity()) {
                throw ApiException.badRequest("Parametro non previsto: " + prefix + "sensitivity");
            }
            if (!AlertCatalog.SENSITIVITIES.containsKey(change.sensitivity())) {
                throw ApiException.badRequest("Parametro non valido: " + prefix + "sensitivity");
            }
            chosen.put("sensitivity", change.sensitivity());
        }
        if (change.days() != null) {
            AlertCatalog.DaysRange range = rule.params().days();
            if (range == null) {
                throw ApiException.badRequest("Parametro non previsto: " + prefix + "days");
            }
            if (change.days() < range.min() || change.days() > range.max()) {
                throw ApiException.badRequest("Parametro non valido: " + prefix + "days");
            }
            chosen.put("days", change.days());
        }
        if (change.threshold() != null) {
            ThresholdRange range = rule.params().threshold();
            if (range == null) {
                throw ApiException.badRequest("Parametro non previsto: " + prefix + "threshold");
            }
            double value = change.threshold();
            if (!Double.isFinite(value) || value < range.min() || value > range.max()) {
                throw ApiException.badRequest("Parametro non valido: " + prefix + "threshold");
            }
            chosen.put("threshold", value);
        }
        if (change.delivery() != null) {
            if (!AlertCatalog.DELIVERIES.contains(change.delivery())) {
                throw ApiException.badRequest("Parametro non valido: " + prefix + "delivery");
            }
            chosen.put("delivery", change.delivery());
        }
    }

    /** The configuration in use for every rule: stored choices over the defaults. */
    private Map<String, RuleConfig> rules(String deviceId) {
        Map<String, RuleRow> stored = repository.rules(deviceId);
        Map<String, RuleConfig> rules = new LinkedHashMap<>();
        for (Definition rule : AlertCatalog.ALL) {
            rules.put(rule.id(), effective(rule, stored.get(rule.id())));
        }
        return rules;
    }

    /** A stored choice that is no longer valid for the rule (e.g. a range changed) falls back to the default. */
    private RuleConfig effective(Definition rule, RuleRow row) {
        RuleConfig defaults = rule.defaults();
        Map<String, Object> chosen = chosen(row);
        String sensitivity = defaults.sensitivity();
        if (rule.params().sensitivity() && chosen.get("sensitivity") instanceof String s && AlertCatalog.SENSITIVITIES.containsKey(s)) {
            sensitivity = s;
        }
        Integer days = defaults.days();
        AlertCatalog.DaysRange dayRange = rule.params().days();
        if (dayRange != null && chosen.get("days") instanceof Number n && n.intValue() >= dayRange.min() && n.intValue() <= dayRange.max()) {
            days = n.intValue();
        }
        Double threshold = defaults.threshold();
        ThresholdRange range = rule.params().threshold();
        if (range != null && chosen.get("threshold") instanceof Number n && n.doubleValue() >= range.min() && n.doubleValue() <= range.max()) {
            threshold = n.doubleValue();
        }
        String delivery = defaults.delivery();
        if (chosen.get("delivery") instanceof String d && AlertCatalog.DELIVERIES.contains(d)) {
            delivery = d;
        }
        boolean enabled = row != null ? row.enabled() : defaults.enabled();
        return new RuleConfig(enabled, sensitivity, days, threshold, delivery);
    }

    private Map<String, Object> chosen(RuleRow row) {
        if (row == null) {
            return Map.of();
        }
        try {
            Map<String, Object> values = json.readValue(row.config(), MAP);
            return values == null ? Map.of() : values;
        } catch (RuntimeException e) {
            return Map.of();
        }
    }

    private static RuleView view(Definition rule, RuleConfig config) {
        ThresholdRange range = rule.params().threshold();
        ThresholdView threshold = range == null
                ? null
                : new ThresholdView(range.unit(), number(range.min()), number(range.max()), number(range.step()));
        return new RuleView(
                rule.id(), rule.name(), rule.description(), rule.level(), rule.usesAverage(),
                new ParamsView(rule.params().sensitivity(), rule.params().days(), threshold),
                config.enabled(), config.sensitivity(), config.days(),
                config.threshold() == null ? null : number(config.threshold()), config.delivery());
    }

    private static CustomRuleView view(Rule rule) {
        return new CustomRuleView(
                rule.id(), CustomCatalog.name(rule), rule.metric(), rule.comparison(), number(rule.amount()), rule.days(), rule.level(),
                rule.delivery(), rule.enabled());
    }

    private static MetricView view(Metric metric) {
        CustomCatalog.ValueRange range = metric.value();
        return new MetricView(
                metric.id(), metric.name(), metric.unit(), metric.night(), metric.average(),
                range == null ? null : new ValueView(number(range.min()), number(range.max()), number(range.step())));
    }

    /** 70 rather than 70.0 when there are no decimals. */
    private static Number number(double value) {
        return value == Math.rint(value) && Math.abs(value) < Integer.MAX_VALUE ? (Number) (int) value : (Number) value;
    }
}
