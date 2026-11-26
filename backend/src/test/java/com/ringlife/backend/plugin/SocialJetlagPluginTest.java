package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.compute.History;
import com.ringlife.backend.compute.History.DayResults;

/** Jet lag sociale (ADR 0031). Il 4 novembre 2026 è un mercoledì. Punti medi in minuti dopo la mezzanotte del risveglio. */
class SocialJetlagPluginTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");

    private final SocialJetlagPlugin plugin = new SocialJetlagPlugin();

    private PluginResult run(List<DayResults> days) {
        History history = (device, from, to) -> days.stream().filter(d -> !d.day().isBefore(from) && !d.day().isAfter(to)).toList();
        PluginContext context = new PluginContext("dev", TODAY, NOW, ZONE, plugin.manifest().complete(Map.of()), history, null);
        return plugin.evaluate(context, TODAY);
    }

    /** Ogni giorno delle ultime 4 settimane: `work` nei giorni feriali, `free` nel fine settimana. */
    private static List<DayResults> weeks(double work, double free) {
        List<DayResults> days = new ArrayList<>();
        for (int i = 0; i < SocialJetlagPlugin.WINDOW_DAYS; i++) {
            LocalDate day = TODAY.minusDays(i);
            boolean weekend = day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY;
            days.add(new DayResults(day, Map.of(), Map.of(), Map.of("sleep_midpoint_min", weekend ? free : work)));
        }
        return days;
    }

    private static String row(PluginResult result, String label) {
        Card.ListCard card = result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast).findFirst().orElseThrow();
        return card.rows().stream().filter(r -> r.label().equals(label)).map(Card.Row::value).findFirst().orElseThrow();
    }

    private static List<String> titles(PluginResult result) {
        return result.cards().stream().filter(Card.Text.class::isInstance).map(c -> ((Card.Text) c).title()).toList();
    }

    @Test
    void laterWeekendsGiveTheDifferenceAndTheLevel() {
        // Lavoro: punto medio 03:00. Fine settimana: 04:30.
        PluginResult result = run(weeks(180, 270));
        assertThat(row(result, "Punto medio, giorni di lavoro")).isEqualTo("03:00");
        assertThat(row(result, "Punto medio, fine settimana")).isEqualTo("04:30");
        assertThat(row(result, "Differenza")).isEqualTo("1 h 30 più tardi");
        assertThat(row(result, "Livello")).isEqualTo("medio");
        assertThat(row(result, "Notti valutate")).isEqualTo("20 feriali, 8 nel fine settimana");
        assertThat(titles(result)).contains("Fuso del lunedì");
    }

    @Test
    void twoHoursOrMoreIsHigh() {
        assertThat(row(run(weeks(180, 300)), "Livello")).isEqualTo("alto");
    }

    @Test
    void steadyNightsAreLow() {
        PluginResult result = run(weeks(180, 200));
        assertThat(row(result, "Differenza")).isEqualTo("20 min più tardi");
        assertThat(row(result, "Livello")).isEqualTo("basso");
        assertThat(titles(result)).contains("Orari stabili");
    }

    @Test
    void earlierWeekendsAreSaidAsSuch() {
        PluginResult result = run(weeks(180, 90));
        assertThat(row(result, "Differenza")).isEqualTo("1 h 30 prima");
        assertThat(titles(result)).contains("Fine settimana in anticipo");
    }

    @Test
    void midpointsBeforeMidnightWorkToo() {
        // Lavoro: 23:30 del giorno prima (−30). Fine settimana: 01:00.
        assertThat(row(run(weeks(-30, 60)), "Differenza")).isEqualTo("1 h 30 più tardi");
        assertThat(row(run(weeks(-30, 60)), "Punto medio, giorni di lavoro")).isEqualTo("23:30");
    }

    @Test
    void withTooFewNightsItSaysHowManyAreMissing() {
        List<DayResults> few = weeks(180, 270).stream().filter(d -> d.day().isAfter(TODAY.minusDays(4))).toList();
        PluginResult result = run(few);
        assertThat(result.cards()).hasSize(1);
        assertThat(((Card.Text) result.cards().get(0)).body()).contains("Trovate: 1 e 3.");
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    @Test
    void theHeadlineIsTheDifferenceAndOnlyTheHighLevelAsksForALook() {
        assertThat(headline(run(weeks(180, 200)))).isEqualTo(new PluginResult.Headline("20 min più tardi", null));
        assertThat(headline(run(weeks(180, 250)))).isEqualTo(new PluginResult.Headline("1 h 10 più tardi", null));
        assertThat(headline(run(weeks(180, 300)))).isEqualTo(new PluginResult.Headline("2 h 00 più tardi", "attenzione"));
        assertThat(headline(run(weeks(180, 140)))).isEqualTo(new PluginResult.Headline("40 min prima", null));
        assertThat(headline(run(weeks(300, 180)))).isEqualTo(new PluginResult.Headline("2 h 00 prima", "attenzione"));
    }

    @Test
    void theSameMidpointAllWeekHasNoDifference() {
        assertThat(headline(run(weeks(180, 180)))).isEqualTo(new PluginResult.Headline("Nessuna differenza", null));
    }

    @Test
    void withTooFewNightsThereIsNoHeadline() {
        List<DayResults> few = weeks(180, 270).stream().filter(d -> d.day().isAfter(TODAY.minusDays(4))).toList();
        assertThat(run(few).headline()).isNull();
    }

    @Test
    void itIsAWeeklyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("weekly");
    }

    @Test
    void durationsReadLikeTheApp() {
        assertThat(SocialJetlagPlugin.duration(45)).isEqualTo("45 min");
        assertThat(SocialJetlagPlugin.duration(65)).isEqualTo("1 h 05");
        assertThat(SocialJetlagPlugin.difference(0)).isEqualTo("nessuna");
    }
}
