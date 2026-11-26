package com.ringlife.backend.plugin;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;

import com.ringlife.backend.compute.History;
import com.ringlife.backend.diary.DiaryLog;
import com.ringlife.backend.weather.PressureHistory;
import com.ringlife.backend.weather.UvHistory;

/**
 * Tutto cio' che un plugin puo' leggere (ADR 0013, 0014): il dispositivo, l'istante e il fuso (cosi' un plugin non
 * guarda l'orologio), i risultati giornalieri, il diario in sola lettura e la sua configurazione, gia' completata
 * con i predefiniti del manifest. Pressione atmosferica e indice UV sono in sola lettura (ADR 0017, 0031).
 */
public record PluginContext(
        String deviceId, LocalDate today, Instant now, ZoneId zone, Map<String, Object> config,
        History history,
        DiaryLog diary,
        PressureHistory pressure,
        UvHistory uv) {

    /** Senza letture UV: il plugin Vitamina D dice come averle (ADR 0031). */
    public PluginContext(
            String deviceId, LocalDate today, Instant now, ZoneId zone, Map<String, Object> config, History history, DiaryLog diary,
            PressureHistory pressure) {
        this(deviceId, today, now, zone, config, history, diary, pressure, (from, to) -> List.of());
    }

    /** Senza letture di pressione: la condizione che la usa non si valuta. */
    public PluginContext(
            String deviceId, LocalDate today, Instant now, ZoneId zone, Map<String, Object> config, History history, DiaryLog diary) {
        this(deviceId, today, now, zone, config, history, diary, at -> OptionalDouble.empty());
    }

    public int intConfig(String key) {
        return (Integer) config.get(key);
    }

    public boolean boolConfig(String key) {
        return (Boolean) config.get(key);
    }

    public String timeConfig(String key) {
        return (String) config.get(key);
    }
}
