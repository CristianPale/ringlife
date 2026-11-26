package com.ringlife.backend.plugin;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Cosa produce un plugin per un giorno (ADR 0013): card, insight ed eventuali stati delle entita' di Home Assistant
 * dichiarate nel manifest. Le notifiche push non ci sono: le automazioni di casa leggono le entita'.
 *
 * <p>`headline` is the one-line summary the app shows next to the plugin name (ADR 0041); null when the plugin has
 * nothing short to say, and then the app shows only the plugin name.
 *
 * <p>`alerts` are the alerts the plugin raises for the day (ADR 0045): the alert engine turns each one into an event of
 * the built-in rule it names, if that rule belongs to this plugin and is on. Optional: an empty list is left out of the
 * JSON, so results without alerts keep the shape they had, and results stored before this field read as no alerts.
 */
public record PluginResult(
        List<Card> cards,
        List<Insight> insights,
        List<EntityState> entities,
        Headline headline,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) List<Alert> alerts) {

    public static final PluginResult EMPTY = new PluginResult(List.of(), List.of());

    public PluginResult(List<Card> cards, List<Insight> insights) {
        this(cards, insights, List.of(), null);
    }

    public PluginResult(List<Card> cards, List<Insight> insights, List<EntityState> entities) {
        this(cards, insights, entities, null);
    }

    public PluginResult(List<Card> cards, List<Insight> insights, List<EntityState> entities, Headline headline) {
        this(cards, insights, entities, headline, List.of());
    }

    public PluginResult {
        cards = List.copyOf(cards);
        insights = List.copyOf(insights);
        entities = List.copyOf(entities);
        alerts = alerts == null ? List.of() : List.copyOf(alerts);
    }

    /** The same result with the given headline (null removes it). */
    public PluginResult withHeadline(Headline headline) {
        return new PluginResult(cards, insights, entities, headline, alerts);
    }

    /** The same result with the given alerts (empty removes them). */
    public PluginResult withAlerts(List<Alert> alerts) {
        return new PluginResult(cards, insights, entities, headline, alerts);
    }

    /**
     * An alert raised by a plugin (ADR 0045): `rule` is the id of the built-in alert rule it feeds (e.g.
     * `migraine-risk`), `title` and `body` the short Italian texts of the event, `values` the numbers behind it (kept
     * with the event, never in logs). Level, page to open and delivery come from the rule, not from the plugin.
     */
    public record Alert(String rule, String title, String body, Map<String, Object> values) {
        public Alert {
            if (rule == null || rule.isBlank()) {
                throw new IllegalArgumentException("rule");
            }
            if (title == null || title.isBlank() || body == null || body.isBlank()) {
                throw new IllegalArgumentException("text");
            }
            values = values == null ? Map.of() : Map.copyOf(values);
        }
    }

    /**
     * A short Italian phrase, already capitalized ("Rischio basso", "08:30 – 15:00"), and a tone: null, or
     * `attenzione` only when the user should look at it. It reuses values the plugin already computes.
     */
    public record Headline(String value, String tone) {

        public static final String ATTENTION = "attenzione";

        public Headline {
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException("value");
            }
            if (tone != null && !ATTENTION.equals(tone)) {
                throw new IllegalArgumentException("tone");
            }
        }

        public static Headline of(String value) {
            return new Headline(value, null);
        }

        public static Headline attention(String value) {
            return new Headline(value, ATTENTION);
        }

        /** `attenzione` when `attention` is true, otherwise no tone. */
        public static Headline of(String value, boolean attention) {
            return new Headline(value, attention ? ATTENTION : null);
        }
    }

    /** Una riga di commento: `info` o `attenzione`. */
    public record Insight(String level, String title, String text) {
        public Insight {
            if (!"info".equals(level) && !"attenzione".equals(level)) {
                throw new IllegalArgumentException("level");
            }
            if (title == null || title.isBlank() || text == null || text.isBlank()) {
                throw new IllegalArgumentException("text");
            }
        }
    }

    /** Lo stato di un'entita' dichiarata nel manifest. `state` null = sconosciuto. */
    public record EntityState(String key, String state, Map<String, Object> attributes) {
        public EntityState {
            attributes = attributes == null ? Map.of() : Map.copyOf(attributes);
        }
    }

    public boolean isEmpty() {
        return cards.isEmpty() && insights.isEmpty() && entities.isEmpty() && headline == null && alerts.isEmpty();
    }
}
