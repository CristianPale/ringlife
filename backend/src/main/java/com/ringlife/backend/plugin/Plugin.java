package com.ringlife.backend.plugin;

import java.time.LocalDate;

/**
 * Un modulo tematico (docs/plugins.md, ADR 0013). E' una funzione pura di cio' che il contesto fornisce: non legge
 * il database, non scrive, non chiama servizi esterni. I plugin sono bean Spring registrati nel codice.
 */
public interface Plugin {

    String id();

    PluginManifest manifest();

    /** Le card e gli insight per il giorno indicato. Non lancia per mancanza di dati: restituisce un risultato vuoto. */
    PluginResult evaluate(PluginContext context, LocalDate day);
}
