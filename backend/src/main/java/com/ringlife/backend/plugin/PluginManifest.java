package com.ringlife.backend.plugin;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.ringlife.backend.common.ApiException;

/**
 * Cosa e' un plugin: nome, descrizione, dati che usa e parametri configurabili. `version` cambia quando cambia la
 * logica (come `algo_version`): i risultati di versioni diverse convivono.
 *
 * <p>`cadence` says how often the result is worth a look: {@value #DAILY} plugins get one line in Today, {@value #WEEKLY}
 * plugins go to Trends (ADR 0041). The older constructors default to {@value #DAILY}; every registered plugin passes it
 * explicitly.
 */
public record PluginManifest(
        String id,
        String name,
        String description,
        String version,
        List<String> requires,
        List<Field> config,
        List<EntityDef> entities,
        String cadence) {

    public static final String DAILY = "daily";
    public static final String WEEKLY = "weekly";

    public PluginManifest {
        if (!DAILY.equals(cadence) && !WEEKLY.equals(cadence)) {
            throw new IllegalArgumentException("cadence");
        }
    }

    public PluginManifest(
            String id, String name, String description, String version, List<String> requires, List<Field> config, List<EntityDef> entities) {
        this(id, name, description, version, requires, config, entities, DAILY);
    }

    public PluginManifest(String id, String name, String description, String version, List<String> requires, List<Field> config) {
        this(id, name, description, version, requires, config, List.of(), DAILY);
    }

    /**
     * Un'entita' di Home Assistant del plugin (sensore `enum`): la sua configurazione di discovery esce anche prima del
     * primo calcolo. `key` diventa `sensor.ringlife_<key>`; `options` sono i valori ammessi, stabili per le automazioni.
     */
    public record EntityDef(String key, String name, String icon, List<String> options) {}

    public enum FieldType {
        INT,
        BOOL,
        TIME
    }

    /** Un parametro. `min` e `max` valgono solo per INT; `defaultValue` e' Integer, Boolean o «HH:mm». */
    public record Field(String key, String label, FieldType type, Object defaultValue, Integer min, Integer max) {

        public static Field integer(String key, String label, int defaultValue, int min, int max) {
            return new Field(key, label, FieldType.INT, defaultValue, min, max);
        }

        public static Field bool(String key, String label, boolean defaultValue) {
            return new Field(key, label, FieldType.BOOL, defaultValue, null, null);
        }

        public static Field time(String key, String label, String defaultValue) {
            return new Field(key, label, FieldType.TIME, defaultValue, null, null);
        }

        /** Il valore validato, o 400 se non e' del tipo giusto o esce dall'intervallo. */
        Object check(Object value) {
            switch (type) {
                case INT -> {
                    if (!(value instanceof Integer number) || number < min || number > max) {
                        throw ApiException.badRequest("Parametro non valido: " + key);
                    }
                    return number;
                }
                case BOOL -> {
                    if (!(value instanceof Boolean flag)) {
                        throw ApiException.badRequest("Parametro non valido: " + key);
                    }
                    return flag;
                }
                default -> {
                    if (!(value instanceof String text) || !text.matches("([01]\\d|2[0-3]):[0-5]\\d")) {
                        throw ApiException.badRequest("Parametro non valido: " + key);
                    }
                    return text;
                }
            }
        }
    }

    /** I predefiniti, con sopra i valori scelti. Una chiave che il manifest non conosce rifiuta la richiesta (400). */
    public Map<String, Object> complete(Map<String, Object> chosen) {
        Map<String, Object> all = new LinkedHashMap<>();
        for (Field field : config) {
            all.put(field.key(), field.defaultValue());
        }
        for (Map.Entry<String, Object> entry : chosen.entrySet()) {
            Field field = config.stream().filter(f -> f.key().equals(entry.getKey())).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("Parametro sconosciuto: " + entry.getKey()));
            all.put(field.key(), field.check(entry.getValue()));
        }
        return all;
    }
}
