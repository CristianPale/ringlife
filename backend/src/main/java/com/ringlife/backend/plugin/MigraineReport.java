package com.ringlife.backend.plugin;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * I dati del riepilogo delle cefalee (ADR 0015) e del report per il medico (ADR 0019). Un solo calcolo
 * ({@code MigrainePlugin.reportData}) per le card del telefono e per il PDF: stessi numeri, stessi criteri.
 */
public final class MigraineReport {

    private MigraineReport() {}

    /**
     * @param summary {@code null} senza cefalee nel periodo
     * @param recurrences vuote sotto i 5 episodi o se nessuna condizione ricorre abbastanza
     */
    public record Data(LocalDate from, LocalDate to, int days, Summary summary, List<EpisodeRow> episodes, List<Recurrence> recurrences) {}

    /** {@code averageDurationMin} e' {@code null} se nessun episodio e' chiuso. */
    public record Summary(
            int episodes, int headacheDays, int peakMax, double peakAverage, int medicationDays, int medicationIntakes, Long averageDurationMin) {}

    /** Un episodio, dal diario. Sintomi, lato, efficacia e cause sono i codici del diario; mai le note libere. */
    public record EpisodeRow(
            long start,
            Long end,
            int peak,
            List<String> symptoms,
            String location,
            int medicationCount,
            String medicationHelp,
            List<String> causes) {}

    /** Una condizione scattata nei giorni con cefalea molto piu' spesso che negli altri: numeri assoluti, mai una percentuale sola. */
    public record Recurrence(String label, int headacheTriggered, int headacheEvaluated, int otherTriggered, int otherEvaluated) {
        public String describe() {
            return headacheTriggered + " su " + headacheEvaluated + " contro " + otherTriggered + " su " + otherEvaluated;
        }
    }

    private static final Map<String, String> SYMPTOMS =
            Map.of("photophobia", "fotofobia", "nausea", "nausea", "phonophobia", "fonofobia", "aura", "aura", "other", "altro");
    private static final Map<String, String> LOCATIONS =
            Map.of("left", "sinistra", "right", "destra", "both", "entrambi i lati", "nape", "nuca");
    private static final Map<String, String> HELP = Map.of("a_lot", "molto", "a_little", "poco", "not_at_all", "per niente");
    private static final Map<String, String> CAUSES = Map.of(
            "little_sleep", "poco sonno", "stress", "stress", "skipped_meal", "pasto saltato", "weather", "meteo", "screens", "schermi", "other", "altro");

    public static String symptom(String code) {
        return SYMPTOMS.getOrDefault(code, code);
    }

    public static String location(String code) {
        return LOCATIONS.getOrDefault(code, code);
    }

    public static String help(String code) {
        return HELP.getOrDefault(code, code);
    }

    public static String cause(String code) {
        return CAUSES.getOrDefault(code, code);
    }
}
