package com.ringlife.backend.plugin;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.History.DayResults;
import com.ringlife.backend.plugin.PluginManifest.Field;

/**
 * Allineamento circadiano (ADR 0016): quanto il punto medio del sonno delle ultime 7 notti si scosta da quello che
 * ti sei dato come obiettivo, e quanto cambia da una notte all'altra. Suggerimenti di abitudine, non consigli medici.
 */
@Component
class CircadianPlugin implements Plugin {

    static final String ID = "circadian";

    /** Notti minime con il sonno registrato per valutare. */
    static final int MIN_NIGHTS = 4;

    /** Ritardo del punto medio da cui si suggerisce di anticipare, in minuti. */
    static final int LATE_MINUTES = 30;

    /** Variazione tra le notti da cui si suggerisce di tenere orari piu' fissi, in minuti. */
    static final int VARIATION_MINUTES = 60;

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Ritmo circadiano",
            "Quanto il punto medio del tuo sonno è vicino all'obiettivo e quanto cambia da una notte all'altra.",
            "1",
            List.of("Sonno degli ultimi 7 giorni"),
            List.of(
                    Field.time("bedtime", "Coricarsi abituale", "23:00"),
                    Field.time("wakeTime", "Risveglio abituale", "07:00")),
            List.of(),
            PluginManifest.WEEKLY);

    @Override
    public String id() {
        return ID;
    }

    @Override
    public PluginManifest manifest() {
        return manifest;
    }

    @Override
    public PluginResult evaluate(PluginContext context, LocalDate day) {
        int bedtime = Hhmm.minutes(context.timeConfig("bedtime"));
        int wake = Hhmm.minutes(context.timeConfig("wakeTime"));
        int duration = Math.floorMod(wake - bedtime, Hhmm.DAY_MINUTES);
        // Il punto medio nelle stesse coordinate della feature: minuti dopo la mezzanotte del giorno del risveglio.
        double target = wake - duration / 2.0;

        List<DayResults> days = context.history().days(context.deviceId(), day.minusDays(6), day);
        List<Double> diffs = days.stream()
                .map(d -> d.features().get(Features.MIDPOINT_MIN))
                .filter(m -> m != null)
                .map(m -> Hhmm.circularDiff(m, target))
                .toList();

        if (diffs.size() < MIN_NIGHTS) {
            return new PluginResult(
                    List.of(new Card.Text(
                            "Ritmo circadiano",
                            "Servono almeno " + MIN_NIGHTS + " notti con il sonno registrato nell'ultima settimana per valutare "
                                    + "l'allineamento. Notti trovate: " + diffs.size() + ".")),
                    List.of());
        }

        double mean = diffs.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
        double variation = Math.sqrt(diffs.stream().mapToDouble(d -> (d - mean) * (d - mean)).average().orElseThrow());
        long shift = Math.round(mean);

        List<Card> cards = new ArrayList<>();
        days.stream()
                .filter(d -> d.scores().containsKey("sleep_regularity"))
                .reduce((first, second) -> second)
                .ifPresent(d -> {
                    int value = d.scores().get("sleep_regularity");
                    cards.add(new Card.Score(
                            "Regolarità del sonno", value, value >= 85 ? "ottimo" : value >= 70 ? "buono" : "attenzione",
                            "L'indice dell'ultima notte registrata."));
                });
        cards.add(new Card.ListCard(
                "Punto medio del sonno",
                List.of(
                        new Card.Row("Media delle ultime notti", Hhmm.format(Math.round(target + mean))),
                        new Card.Row("Obiettivo", Hhmm.format(Math.round(target))),
                        new Card.Row("Scostamento", signed(shift) + " min"),
                        new Card.Row("Variazione tra le notti", Math.round(variation) + " min"),
                        new Card.Row("Notti valutate", String.valueOf(diffs.size())))));

        if (shift >= LATE_MINUTES) {
            cards.add(new Card.Text(
                    "Per anticipare il sonno",
                    "Il punto medio del tuo sonno è in ritardo di " + shift + " minuti. Luce del mattino e un po' di movimento "
                            + "appena sveglio possono aiutare a spostarlo prima."));
        }
        if (variation >= VARIATION_MINUTES) {
            cards.add(new Card.Text(
                    "Orari più fissi",
                    "Il punto medio cambia di circa " + Math.round(variation) + " minuti da una notte all'altra. "
                            + "Provare a svegliarti entro un'ora dallo stesso orario rende il ritmo più stabile."));
        }
        cards.add(new Card.Text(null, "Sono suggerimenti di abitudine con soglie iniziali, non consigli medici."));
        return new PluginResult(cards, List.of(), List.of(), headline(shift));
    }

    /**
     * "In linea" when the midpoint is on target, otherwise the shift as on the card ("+25 min dall'obiettivo"). A late
     * shift that gets the advice card asks for a look.
     */
    static PluginResult.Headline headline(long shift) {
        if (shift == 0) {
            return PluginResult.Headline.of("In linea");
        }
        return PluginResult.Headline.of(signed(shift) + " min dall'obiettivo", shift >= LATE_MINUTES);
    }

    private static String signed(long minutes) {
        return String.format(Locale.ROOT, "%+d", minutes).replace('-', '−');
    }
}
