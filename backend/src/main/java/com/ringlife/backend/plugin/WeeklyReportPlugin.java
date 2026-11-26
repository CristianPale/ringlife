package com.ringlife.backend.plugin;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.History.DayResults;

/**
 * Report settimanale: sonno, movimento e recupero degli ultimi 7 giorni finiti, a confronto con i 7 prima.
 * Non guarda i giorni in corso: gli indici di oggi non sono completi (docs/scores.md).
 */
@Component
class WeeklyReportPlugin implements Plugin {

    static final String ID = "weekly-report";

    /** Giorni minimi con un indice per mostrarne la media. */
    static final int MIN_DAYS = 3;

    /** Scostamento (punti) da cui la settimana merita un commento. */
    static final int NOTABLE_CHANGE = 8;

    private record Index(String kind, String name) {}

    private static final List<Index> INDICES =
            List.of(new Index("recovery", "Recupero"), new Index("sleep", "Sonno"), new Index("movement", "Movimento"));

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Report settimanale",
            "Sonno, movimento e recupero degli ultimi 7 giorni a confronto con la settimana prima.",
            "1",
            List.of("Indici giornalieri"),
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
        LocalDate lastDay = day.minusDays(1);
        List<DayResults> days = context.history().days(context.deviceId(), day.minusDays(14), lastDay);

        List<Card> cards = new ArrayList<>();
        List<PluginResult.Insight> insights = new ArrayList<>();
        List<Change> changes = new ArrayList<>();
        for (Index index : INDICES) {
            Optional<Double> thisWeek = average(days, index.kind(), lastDay.minusDays(6), lastDay);
            if (thisWeek.isEmpty()) {
                continue;
            }
            Optional<Double> before = average(days, index.kind(), lastDay.minusDays(13), lastDay.minusDays(7));
            int value = (int) Math.round(thisWeek.get());
            cards.add(new Card.Score(index.name(), value, zone(value), caption(value, before)));
            before.ifPresent(previous -> {
                int change = value - (int) Math.round(previous);
                changes.add(new Change(index.name(), change));
                if (Math.abs(change) >= NOTABLE_CHANGE) {
                    insights.add(new PluginResult.Insight(
                            "info",
                            index.name() + (change > 0 ? ": settimana migliore" : ": settimana più bassa"),
                            "La media dei 7 giorni è " + value + ", " + signed(change) + " rispetto alla settimana prima."));
                }
            });
        }
        if (cards.isEmpty()) {
            return PluginResult.EMPTY;
        }
        return new PluginResult(cards, insights, List.of(), headline(changes));
    }

    /** The change of one index between this week and the one before, in points. */
    record Change(String name, int points) {}

    /**
     * The largest change, if notable ("Sonno +9", "Recupero −8"; on a tie the first index in card order); a notable
     * drop asks for a look. Without a notable change "Settimana stabile"; with no week to compare, null.
     */
    static PluginResult.Headline headline(List<Change> changes) {
        if (changes.isEmpty()) {
            return null;
        }
        Change largest = changes.get(0);
        for (Change change : changes) {
            if (Math.abs(change.points()) > Math.abs(largest.points())) {
                largest = change;
            }
        }
        if (Math.abs(largest.points()) < NOTABLE_CHANGE) {
            return PluginResult.Headline.of("Settimana stabile");
        }
        return PluginResult.Headline.of(largest.name() + " " + signed(largest.points()), largest.points() < 0);
    }

    /** Media di un indice sui giorni dell'intervallo, se ce ne sono abbastanza. */
    private static Optional<Double> average(List<DayResults> days, String kind, LocalDate from, LocalDate to) {
        List<Integer> values = days.stream()
                .filter(d -> !d.day().isBefore(from) && !d.day().isAfter(to))
                .map(d -> d.scores().get(kind))
                .filter(v -> v != null)
                .toList();
        if (values.size() < MIN_DAYS) {
            return Optional.empty();
        }
        return Optional.of(values.stream().mapToInt(Integer::intValue).average().orElseThrow());
    }

    private static String caption(int value, Optional<Double> before) {
        if (before.isEmpty()) {
            return "Media degli ultimi 7 giorni. Ancora pochi giorni nella settimana prima per un confronto.";
        }
        int change = value - (int) Math.round(before.get());
        return change == 0
                ? "Media degli ultimi 7 giorni, come la settimana prima."
                : "Media degli ultimi 7 giorni, " + signed(change) + " rispetto alla settimana prima.";
    }

    private static String signed(int change) {
        return String.format(Locale.ROOT, "%+d", change).replace('-', '−');
    }

    /** Stesse soglie dell'app: 85 ottimo, 70 buono, sotto attenzione. */
    private static String zone(int value) {
        return value >= 85 ? "ottimo" : value >= 70 ? "buono" : "attenzione";
    }
}
