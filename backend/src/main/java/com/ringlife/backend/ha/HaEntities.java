package com.ringlife.backend.ha;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.LatestResults.Latest;
import com.ringlife.backend.plugin.PluginManifest.EntityDef;
import com.ringlife.backend.plugin.PluginResult.EntityState;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Le entita' di Home Assistant (ADR 0011, docs/ha-entities.md): definizioni, messaggi di discovery e stati.
 * Funzioni pure: gli stessi dati danno gli stessi messaggi.
 */
final class HaEntities {

    private HaEntities() {}

    static final String ONLINE = "online";
    static final String OFFLINE = "offline";
    static final String AVAILABILITY_TOPIC = "ringlife/availability";
    /** Stato di un'entita' senza dati: HA lo legge come «sconosciuto». */
    static final String NONE = "None";
    static final String NODE = "ringlife";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Un sensore: chiave stabile (`unique_id` = `ringlife_<chiave>`), nome in italiano, unita' e classi di HA. */
    record Definition(
            String key, String name, String unit, String deviceClass, String stateClass, String icon, boolean attributes, List<String> options) {

        Definition(String key, String name, String unit, String deviceClass, String stateClass, String icon, boolean attributes) {
            this(key, name, unit, deviceClass, stateClass, icon, attributes, null);
        }
    }

    /** Un messaggio da pubblicare. */
    record Message(String topic, String payload, boolean retained) {}

    static final List<Definition> ALL = List.of(
            score("sleep_index", "Indice sonno", "mdi:sleep"),
            score("movement_index", "Indice movimento", "mdi:walk"),
            score("recovery_score", "Recupero", "mdi:heart-pulse"),
            score("stress_rhythm", "Stress", "mdi:head-snowflake-outline"),
            new Definition("sleep_debt", "Debito di sonno", "h", "duration", "measurement", "mdi:bed-clock", false),
            new Definition("resting_hr", "Battito a riposo", "bpm", null, "measurement", "mdi:heart", false),
            new Definition("hrv", "Variabilità cardiaca (HRV)", "ms", null, "measurement", "mdi:heart-flash", false),
            new Definition("temp_deviation", "Temperatura, scostamento", "°C", null, "measurement", "mdi:thermometer", false),
            new Definition("sleep_start", "Inizio del sonno", null, "timestamp", null, "mdi:bed", false),
            new Definition("sleep_end", "Fine del sonno", null, "timestamp", null, "mdi:alarm", false),
            new Definition("steps_today", "Passi di oggi", "passi", null, "measurement", "mdi:shoe-print", false),
            new Definition("last_sync", "Ultimo sync", null, "timestamp", null, "mdi:sync", false));

    private static Definition score(String key, String name, String icon) {
        return new Definition(key, name, null, null, "measurement", icon, true);
    }

    static String configTopic(String discoveryPrefix, Definition d) {
        return discoveryPrefix + "/sensor/" + NODE + "/" + d.key() + "/config";
    }

    static String stateTopic(Definition d) {
        return "ringlife/" + d.key() + "/state";
    }

    static String attributesTopic(Definition d) {
        return "ringlife/" + d.key() + "/attributes";
    }

    /** Messaggio di configurazione retained di un sensore. */
    static Message config(String discoveryPrefix, Definition d) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("name", d.name());
        config.put("unique_id", "ringlife_" + d.key());
        // L'identificativo dell'entita' e' il contratto con le automazioni di casa: `sensor.ringlife_<chiave>`.
        // `default_entity_id` sostituisce `object_id` da Home Assistant 2025.10 (verificato con HA 2026.10.4).
        config.put("default_entity_id", "sensor." + "ringlife_" + d.key());
        config.put("state_topic", stateTopic(d));
        config.put("availability_topic", AVAILABILITY_TOPIC);
        config.put("payload_available", ONLINE);
        config.put("payload_not_available", OFFLINE);
        if (d.unit() != null) {
            config.put("unit_of_measurement", d.unit());
        }
        if (d.deviceClass() != null) {
            config.put("device_class", d.deviceClass());
        }
        if (d.stateClass() != null) {
            config.put("state_class", d.stateClass());
        }
        if (d.options() != null) {
            config.put("options", d.options());
        }
        config.put("icon", d.icon());
        if (d.attributes()) {
            config.put("json_attributes_topic", attributesTopic(d));
        }
        Map<String, Object> device = new LinkedHashMap<>();
        device.put("identifiers", List.of("ringlife"));
        device.put("name", "RingLife");
        device.put("model", "R09");
        config.put("device", device);
        return new Message(configTopic(discoveryPrefix, d), JSON.writeValueAsString(config), true);
    }

    /** Risultati vuoti: ogni sensore pubblica `None`. */
    static Latest noData() {
        return new Latest(null, null, Map.of(), Map.of(), Map.of(), null, null, null, null);
    }

    /** Un sensore `enum` per un'entita' di plugin (ADR 0014): stessa famiglia, attributi sempre previsti. */
    static Definition pluginDefinition(EntityDef entity) {
        return new Definition(entity.key(), entity.name(), null, "enum", null, entity.icon(), true, entity.options());
    }

    static List<Message> pluginConfigs(String discoveryPrefix, List<EntityDef> entities) {
        return entities.stream().map(e -> config(discoveryPrefix, pluginDefinition(e))).toList();
    }

    /** Stato e attributi delle entita' di plugin. Senza stato (plugin spento, nessun calcolo) pubblicano `None`. */
    static List<Message> pluginStates(List<EntityDef> entities, Map<String, EntityState> states) {
        List<Message> messages = new ArrayList<>();
        for (EntityDef entity : entities) {
            Definition definition = pluginDefinition(entity);
            EntityState state = states.get(entity.key());
            String value = state == null || state.state() == null ? NONE : state.state();
            messages.add(new Message(stateTopic(definition), value, true));
            messages.add(new Message(
                    attributesTopic(definition), state == null ? "{}" : JSON.writeValueAsString(state.attributes()), true));
        }
        return messages;
    }

    /**
     * The optional alerts sensor (ADR 0045): unseen events, with title, level and day of the latest one as attributes.
     * Published only while the device has `homeAssistant` on in its alert settings; not part of {@link #ALL}.
     */
    static final Definition ALERTS = new Definition("alerts", "Avvisi", "avvisi", null, "measurement", "mdi:bell-alert", true);

    static Message alertsConfig(String discoveryPrefix) {
        return config(discoveryPrefix, ALERTS);
    }

    /** State (unseen count) and attributes of the alerts sensor; without events the attributes are empty. */
    static List<Message> alertsStates(AlertService.HaSummary summary) {
        Map<String, Object> attributes = new LinkedHashMap<>();
        if (summary.title() != null) {
            attributes.put("title", summary.title());
            attributes.put("level", summary.level());
            attributes.put("day", summary.day());
        }
        return List.of(
                new Message(stateTopic(ALERTS), String.valueOf(summary.unseen()), true),
                new Message(attributesTopic(ALERTS), JSON.writeValueAsString(attributes), true));
    }

    /**
     * Removes the alerts sensor from Home Assistant: an empty retained discovery config deletes the entity, empty
     * retained state and attributes clear what the broker kept.
     */
    static List<Message> alertsRemoval(String discoveryPrefix) {
        return List.of(
                new Message(configTopic(discoveryPrefix, ALERTS), "", true),
                new Message(stateTopic(ALERTS), "", true),
                new Message(attributesTopic(ALERTS), "", true));
    }

    static List<Message> configs(String discoveryPrefix) {
        return ALL.stream().map(d -> config(discoveryPrefix, d)).toList();
    }

    /** Stati e attributi dei sensori, dai risultati piu' recenti. Un sensore senza dato pubblica `None`. */
    static List<Message> states(Latest latest) {
        List<Message> messages = new ArrayList<>();
        for (Definition d : ALL) {
            messages.add(new Message(stateTopic(d), state(d, latest), true));
            if (d.attributes()) {
                messages.add(new Message(attributesTopic(d), attributes(d, latest), true));
            }
        }
        return messages;
    }

    private static String scoreKind(String key) {
        return switch (key) {
            case "sleep_index" -> "sleep";
            case "movement_index" -> "movement";
            case "recovery_score" -> "recovery";
            case "stress_rhythm" -> "stress";
            default -> null;
        };
    }

    static String state(Definition d, Latest latest) {
        String kind = scoreKind(d.key());
        if (kind != null) {
            var score = latest.scores().get(kind);
            return score == null ? NONE : String.valueOf(score.value());
        }
        return switch (d.key()) {
            case "sleep_debt" -> number(latest.metrics().get("sleep_debt") == null ? null : latest.metrics().get("sleep_debt").value(), 2);
            case "temp_deviation" -> number(latest.metrics().get("temp_deviation") == null ? null : latest.metrics().get("temp_deviation").value(), 2);
            case "resting_hr" -> number(latest.features().get(Features.RESTING_HR), 0);
            case "hrv" -> number(latest.features().get(Features.HRV_NIGHT), 0);
            case "steps_today" -> number(latest.stepsToday(), 0);
            case "sleep_start" -> instant(latest.sleepStart());
            case "sleep_end" -> instant(latest.sleepEnd());
            case "last_sync" -> instant(latest.lastSyncAt());
            default -> NONE;
        };
    }

    /** Attributi di un indice: giorno, versione della formula e componenti (per spiegare il punteggio). */
    static String attributes(Definition d, Latest latest) {
        var score = latest.scores().get(scoreKind(d.key()));
        if (score == null) {
            return "{}";
        }
        Map<String, Object> attributes = new LinkedHashMap<>();
        attributes.put("day", score.day());
        attributes.put("algo_version", score.algoVersion());
        JsonNode components = JSON.readTree(score.componentsJson());
        attributes.put("components", components);
        return JSON.writeValueAsString(attributes);
    }

    private static String number(Double value, int decimals) {
        if (value == null || !Double.isFinite(value)) {
            return NONE;
        }
        if (decimals == 0) {
            return String.valueOf(Math.round(value));
        }
        double scale = Math.pow(10, decimals);
        return String.valueOf(Math.round(value * scale) / scale);
    }

    private static String instant(Long epochMillis) {
        return epochMillis == null ? NONE : Instant.ofEpochMilli(epochMillis).toString();
    }
}
