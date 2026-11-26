package com.ringlife.backend.plugin;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.History.DayResults;

/**
 * Jet lag sociale (ADR 0031): quanto il punto medio del sonno dei fine settimana si sposta rispetto a quello dei giorni
 * di lavoro, nelle ultime 4 settimane. Una notte appartiene al giorno del risveglio: sabato e domenica sono i giorni
 * liberi. Suggerimenti di abitudine, non consigli medici.
 */
@Component
class SocialJetlagPlugin implements Plugin {

    static final String ID = "social-jetlag";

    /** Giorni guardati, oggi compreso. */
    static final int WINDOW_DAYS = 28;

    static final int MIN_FREE_NIGHTS = 2;
    static final int MIN_WORK_NIGHTS = 3;

    /** Da qui il livello è «medio», e da `HIGH_MINUTES` «alto». Soglie iniziali. */
    static final int MEDIUM_MINUTES = 60;
    static final int HIGH_MINUTES = 120;

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Jet lag sociale",
            "Quanto si sposta il tuo sonno nel fine settimana rispetto ai giorni di lavoro.",
            "1",
            List.of("Sonno delle ultime 4 settimane"),
            List.of(),
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
        List<Double> free = new ArrayList<>();
        List<Double> work = new ArrayList<>();
        for (DayResults d : context.history().days(context.deviceId(), day.minusDays(WINDOW_DAYS - 1), day)) {
            Double midpoint = d.features().get(Features.MIDPOINT_MIN);
            if (midpoint == null) {
                continue;
            }
            DayOfWeek weekday = d.day().getDayOfWeek();
            (weekday == DayOfWeek.SATURDAY || weekday == DayOfWeek.SUNDAY ? free : work).add(midpoint);
        }

        if (free.size() < MIN_FREE_NIGHTS || work.size() < MIN_WORK_NIGHTS) {
            return new PluginResult(
                    List.of(new Card.Text(
                            "Jet lag sociale",
                            "Servono almeno " + MIN_FREE_NIGHTS + " notti di fine settimana e " + MIN_WORK_NIGHTS
                                    + " di giorni di lavoro con il sonno registrato nelle ultime 4 settimane. Trovate: "
                                    + free.size() + " e " + work.size() + ".")),
                    List.of());
        }

        double freeMid = median(free);
        double workMid = median(work);
        long shift = Math.round(Hhmm.circularDiff(freeMid, workMid));
        long size = Math.abs(shift);
        String level = size >= HIGH_MINUTES ? "alto" : size >= MEDIUM_MINUTES ? "medio" : "basso";

        List<Card> cards = new ArrayList<>();
        cards.add(new Card.ListCard(
                "Jet lag sociale",
                List.of(
                        new Card.Row("Punto medio, giorni di lavoro", Hhmm.format(Math.round(workMid))),
                        new Card.Row("Punto medio, fine settimana", Hhmm.format(Math.round(freeMid))),
                        new Card.Row("Differenza", difference(shift)),
                        new Card.Row("Livello", level),
                        new Card.Row("Notti valutate", work.size() + " feriali, " + free.size() + " nel fine settimana"))));
        if (size < MEDIUM_MINUTES) {
            cards.add(new Card.Text(
                    "Orari stabili",
                    "Il tuo sonno resta quasi allo stesso orario tutta la settimana: per il corpo non c'è un cambio di fuso."));
        } else if (shift > 0) {
            cards.add(new Card.Text(
                    "Fuso del lunedì",
                    "Nel fine settimana il tuo sonno si sposta di " + duration(size) + " più tardi: per il corpo è come cambiare "
                            + "fuso ogni lunedì. Un risveglio vicino a quello dei giorni di lavoro anche sabato e domenica, con la "
                            + "luce del mattino, riduce lo scarto."));
        } else {
            cards.add(new Card.Text(
                    "Fine settimana in anticipo",
                    "Nel fine settimana il tuo sonno si sposta di " + duration(size) + " prima dei giorni di lavoro. Orari "
                            + "più vicini tra loro rendono il ritmo più stabile."));
        }
        cards.add(new Card.Text(
                null, "Sabato e domenica contano come giorni liberi. Soglie iniziali, non consigli medici."));
        return new PluginResult(cards, List.of(), List.of(), headline(shift));
    }

    /** The difference as on the card ("1 h 10 più tardi", "40 min prima"); the high level asks for a look. */
    static PluginResult.Headline headline(long shift) {
        if (shift == 0) {
            return PluginResult.Headline.of("Nessuna differenza");
        }
        return PluginResult.Headline.of(difference(shift), Math.abs(shift) >= HIGH_MINUTES);
    }

    /** «1 h 05 più tardi», «20 min prima», «nessuna». */
    static String difference(long minutes) {
        if (minutes == 0) {
            return "nessuna";
        }
        return duration(Math.abs(minutes)) + (minutes > 0 ? " più tardi" : " prima");
    }

    /** «40 min» o «1 h 05». */
    static String duration(long minutes) {
        return minutes < 60 ? minutes + " min" : (minutes / 60) + " h " + String.format("%02d", minutes % 60);
    }

    private static double median(List<Double> values) {
        List<Double> sorted = values.stream().sorted().toList();
        int n = sorted.size();
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}
