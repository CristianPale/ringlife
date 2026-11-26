package com.ringlife.backend.weather;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.OptionalDouble;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** {@link WeatherClient} sull'API di Home Assistant tramite il Supervisor (ADR 0017). Non lancia mai. */
@Component
class SupervisorWeatherClient implements WeatherClient {

    private final WeatherSettings settings;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    SupervisorWeatherClient(WeatherSettings settings, ObjectMapper json) {
        this.settings = settings;
        this.json = json;
    }

    @Override
    public OptionalDouble currentPressureHpa() {
        if (!settings.enabled()) {
            return OptionalDouble.empty();
        }
        return parse(fetch(settings.entity()));
    }

    /** Dal sensore UV se c'e', altrimenti dall'attributo `uv_index` dell'entita' meteo (ADR 0031). */
    @Override
    public OptionalDouble currentUvIndex() {
        if (!settings.enabled()) {
            return OptionalDouble.empty();
        }
        return settings.uvEntity().isEmpty() ? parseUvAttribute(fetch(settings.entity())) : parseUvSensor(fetch(settings.uvEntity()));
    }

    /** Lo stato di un'entita'. Un errore diventa {@link WeatherUnavailableException} con il solo tipo dell'errore. */
    private JsonNode fetch(String entity) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(settings.apiUrl() + "/states/" + entity))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + settings.token())
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new IllegalStateException("status " + response.statusCode());
            }
            return json.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new WeatherUnavailableException("InterruptedException");
        } catch (Exception e) {
            // Solo il tipo dell'errore: il messaggio potrebbe contenere indirizzi o dati.
            throw new WeatherUnavailableException(e.getClass().getSimpleName());
        }
    }

    /** `attributes.pressure` con `attributes.pressure_unit` (assente = hPa). */
    static OptionalDouble parse(JsonNode state) {
        JsonNode attributes = state.path("attributes");
        JsonNode pressure = attributes.path("pressure");
        if (!pressure.isNumber()) {
            return OptionalDouble.empty();
        }
        String unit = attributes.path("pressure_unit").isString() ? attributes.path("pressure_unit").asString() : null;
        return PressureUnits.toHpa(pressure.asDouble(), unit);
    }

    /** `attributes.uv_index` dell'entita' meteo, se c'e' e se e' credibile. */
    static OptionalDouble parseUvAttribute(JsonNode state) {
        JsonNode uv = state.path("attributes").path("uv_index");
        return uv.isNumber() ? plausibleUv(uv.asDouble()) : OptionalDouble.empty();
    }

    /** Lo stato di un sensore UV: un numero in testo; `unknown` o `unavailable` = nessun valore. */
    static OptionalDouble parseUvSensor(JsonNode state) {
        JsonNode value = state.path("state");
        if (!value.isString()) {
            return OptionalDouble.empty();
        }
        try {
            return plausibleUv(Double.parseDouble(value.asString().trim()));
        } catch (NumberFormatException e) {
            return OptionalDouble.empty();
        }
    }

    private static OptionalDouble plausibleUv(double value) {
        return Double.isFinite(value) && value >= 0 && value <= 20 ? OptionalDouble.of(value) : OptionalDouble.empty();
    }
}
