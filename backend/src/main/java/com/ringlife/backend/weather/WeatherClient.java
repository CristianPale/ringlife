package com.ringlife.backend.weather;

import java.util.OptionalDouble;

/** Legge pressione e indice UV attuali dal meteo di Home Assistant. Dietro un'interfaccia per provarlo senza HA. */
public interface WeatherClient {

    /** La pressione attuale in hPa, o vuota se HA non risponde, l'entita' non ha `pressure` o il valore non e' credibile. */
    OptionalDouble currentPressureHpa();

    /**
     * L'indice UV attuale (ADR 0031), o vuoto se non c'e' o non e' credibile (0-20). Di base nessuno: chi lo sa leggere
     * lo ridefinisce.
     */
    default OptionalDouble currentUvIndex() {
        return OptionalDouble.empty();
    }
}
