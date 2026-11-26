package com.ringlife.backend.weather;

import java.time.Instant;
import java.util.OptionalDouble;

/** La pressione atmosferica in sola lettura per chi la consuma (i plugin, ADR 0017). */
public interface PressureHistory {

    /**
     * La variazione di pressione nelle 24 ore fino a `at`, in hPa (negativa = calo). Vuota se non c'e' una lettura
     * entro 90 minuti da `at` e una entro 90 minuti da 24 ore prima.
     */
    OptionalDouble change24h(Instant at);
}
