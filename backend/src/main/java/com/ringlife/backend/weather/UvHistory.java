package com.ringlife.backend.weather;

import java.time.Instant;
import java.util.List;

/** L'indice UV in sola lettura per chi lo consuma (il plugin Vitamina D, ADR 0031). */
public interface UvHistory {

    /** Le letture da `from` (compreso) a `to` (escluso), dalla piu' vecchia. */
    List<UvReading> between(Instant from, Instant to);
}
