package com.ringlife.backend.diary;

import java.util.List;

/**
 * Il diario in sola lettura per chi lo consuma fuori dal sync (i plugin, ADR 0014): solo bevande e cefalee, mai il
 * testo delle note. Gli istanti sono millisecondi UTC.
 */
public interface DiaryLog {

    /** Una voce di caffeina (`caffeine`) o alcol (`alcohol`). */
    record Drink(long ts, String kind) {}

    /** Un episodio di cefalea. `end` e' null finche' e' aperto; `peak` e' l'intensita' massima del registro; `medicationCount` le assunzioni. */
    record Headache(long start, Long end, int intensity, int peak, int medicationCount) {}

    /**
     * I dettagli di un episodio per il report al medico (ADR 0019): sintomi, lato, come sono andati i farmaci e le cause
     * indicate, con i codici del diario. Mai le note libere. `start` lo collega all'episodio.
     */
    record HeadacheDetails(long start, List<String> symptoms, String location, String medicationHelp, List<String> causes) {}

    /** Le bevande con `from <= ts < to`, in ordine di istante. */
    List<Drink> drinks(String deviceId, long fromMs, long toMs);

    /** Le cefalee iniziate con `from <= start < to`, in ordine di inizio. */
    List<Headache> headaches(String deviceId, long fromMs, long toMs);

    /** I dettagli delle cefalee iniziate con `from <= start < to`, in ordine di inizio. */
    List<HeadacheDetails> headacheDetails(String deviceId, long fromMs, long toMs);

    /** Il dispositivo ha registrato almeno una voce di caffeina o alcol da `fromMs`? Distingue «niente» da «non lo segna». */
    boolean hasDrinkEntriesSince(String deviceId, long fromMs);
}
