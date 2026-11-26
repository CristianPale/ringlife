package com.ringlife.backend.weather;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Collegamento al meteo di Home Assistant (ADR 0017). Entita' vuota o senza token = spento. `uvEntity` facoltativa: un
 * sensore con l'indice UV; vuota = si usa l'attributo `uv_index` dell'entita' meteo (ADR 0031).
 */
@Component
public class WeatherSettings {

    private final String entity;
    private final String uvEntity;
    private final String apiUrl;
    private final String token;

    @Autowired
    WeatherSettings(
            @Value("${ringlife.weather.entity:}") String entity,
            @Value("${ringlife.weather.uv-entity:}") String uvEntity,
            @Value("${ringlife.weather.api-url:http://supervisor/core/api}") String apiUrl,
            @Value("${ringlife.weather.token:}") String token) {
        this.entity = entity == null ? "" : entity.trim();
        this.uvEntity = uvEntity == null ? "" : uvEntity.trim();
        this.apiUrl = apiUrl == null || apiUrl.isBlank() ? "http://supervisor/core/api" : apiUrl.trim().replaceAll("/+$", "");
        this.token = token == null ? "" : token.trim();
    }

    /** Senza sensore UV: solo l'entita' meteo. */
    WeatherSettings(String entity, String apiUrl, String token) {
        this(entity, "", apiUrl, token);
    }

    public boolean enabled() {
        return !entity.isEmpty() && !token.isEmpty();
    }

    public String entity() {
        return entity;
    }

    public String uvEntity() {
        return uvEntity;
    }

    public String apiUrl() {
        return apiUrl;
    }

    public String token() {
        return token;
    }
}
