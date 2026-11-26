package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.compute.History;
import com.ringlife.backend.compute.History.DayResults;

/** Allineamento circadiano (ADR 0016). Il punto medio obiettivo dei predefiniti (23:00-07:00) e' alle 03:00 = 180. */
class CircadianPluginTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");

    private final CircadianPlugin plugin = new CircadianPlugin();

    private static History history(List<DayResults> days) {
        return (device, from, to) -> days.stream().filter(d -> !d.day().isBefore(from) && !d.day().isAfter(to)).toList();
    }

    private static DayResults night(int daysAgo, double midpointMin) {
        return new DayResults(TODAY.minusDays(daysAgo), Map.of("sleep_regularity", 82), Map.of(), Map.of("sleep_midpoint_min", midpointMin));
    }

    private PluginResult run(List<DayResults> days) {
        return run(days, Map.of());
    }

    private PluginResult run(List<DayResults> days, Map<String, Object> chosen) {
        PluginContext context = new PluginContext("dev", TODAY, NOW, ZONE, plugin.manifest().complete(chosen), history(days), null);
        return plugin.evaluate(context, TODAY);
    }

    private static List<DayResults> nights(double... midpoints) {
        List<DayResults> days = new ArrayList<>();
        for (int i = 0; i < midpoints.length; i++) {
            days.add(night(i, midpoints[i]));
        }
        return days;
    }

    private static Card.ListCard list(PluginResult result) {
        return result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast).findFirst().orElseThrow();
    }

    private static String row(Card.ListCard card, String label) {
        return card.rows().stream().filter(r -> r.label().equals(label)).map(Card.Row::value).findFirst().orElseThrow();
    }

    private static List<String> titles(PluginResult result) {
        return result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).map(Card.Text::title).toList();
    }

    @Test
    void nightsOnTargetGiveNoShiftAndNoSuggestion() {
        PluginResult result = run(nights(180, 180, 180, 180, 180));
        Card.ListCard card = list(result);
        assertThat(row(card, "Media delle ultime notti")).isEqualTo("03:00");
        assertThat(row(card, "Obiettivo")).isEqualTo("03:00");
        assertThat(row(card, "Scostamento")).isEqualTo("+0 min");
        assertThat(row(card, "Variazione tra le notti")).isEqualTo("0 min");
        assertThat(row(card, "Notti valutate")).isEqualTo("5");
        assertThat(titles(result)).doesNotContain("Per anticipare il sonno", "Orari più fissi");
    }

    @Test
    void aLateMidpointSuggestsMorningLightAndMovement() {
        // 45 minuti dopo l'obiettivo, ogni notte.
        PluginResult result = run(nights(225, 225, 225, 225));
        assertThat(row(list(result), "Scostamento")).isEqualTo("+45 min");
        assertThat(row(list(result), "Media delle ultime notti")).isEqualTo("03:45");
        Card.Text advice = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast)
                .filter(t -> "Per anticipare il sonno".equals(t.title())).findFirst().orElseThrow();
        assertThat(advice.body()).contains("45 minuti").contains("Luce del mattino").contains("movimento");
    }

    @Test
    void anEarlyMidpointGetsNoAdviceToCorrectIt() {
        PluginResult result = run(nights(120, 120, 120, 120));
        assertThat(row(list(result), "Scostamento")).isEqualTo("−60 min");
        assertThat(titles(result)).doesNotContain("Per anticipare il sonno");
    }

    @Test
    void shiftsBelowThirtyMinutesGetNoAdvice() {
        PluginResult result = run(nights(205, 205, 205, 205));
        assertThat(row(list(result), "Scostamento")).isEqualTo("+25 min");
        assertThat(titles(result)).doesNotContain("Per anticipare il sonno");
    }

    @Test
    void aBigVariationBetweenNightsSuggestsFixedTimes() {
        // Scostamenti -90, +90, -90, +90: media 0, variazione 90.
        PluginResult result = run(nights(90, 270, 90, 270));
        assertThat(row(list(result), "Variazione tra le notti")).isEqualTo("90 min");
        assertThat(titles(result)).contains("Orari più fissi");
        assertThat(titles(result)).doesNotContain("Per anticipare il sonno");
    }

    @Test
    void nightsAcrossMidnightDoNotBreakTheAverage() {
        // Obiettivo a mezzanotte: coricarsi 20:00, risveglio 04:00. Notti a -10 e +10 minuti: scostamento ~0, non 720.
        PluginResult result = run(nights(-10, 10, -10, 10), Map.of("bedtime", "20:00", "wakeTime", "04:00"));
        assertThat(row(list(result), "Obiettivo")).isEqualTo("00:00");
        assertThat(row(list(result), "Scostamento")).isEqualTo("+0 min");
        assertThat(row(list(result), "Variazione tra le notti")).isEqualTo("10 min");
    }

    @Test
    void withFewerThanFourNightsItSaysSoAndShowsNoNumbers() {
        PluginResult result = run(nights(180, 180, 180));
        assertThat(result.cards()).hasSize(1);
        Card.Text text = (Card.Text) result.cards().get(0);
        assertThat(text.body()).contains("Servono almeno 4 notti").contains("Notti trovate: 3");
    }

    @Test
    void onlyTheLastSevenDaysCount() {
        List<DayResults> days = new ArrayList<>(nights(180, 180, 180, 180));
        days.add(night(7, 600));
        days.add(night(8, 600));
        assertThat(row(list(run(days)), "Notti valutate")).isEqualTo("4");
        assertThat(row(list(run(days)), "Scostamento")).isEqualTo("+0 min");
    }

    @Test
    void theRegularityIndexOfTheLastNightIsShownWithItsZone() {
        PluginResult result = run(nights(180, 180, 180, 180));
        Card.Score score = result.cards().stream().filter(Card.Score.class::isInstance).map(Card.Score.class::cast).findFirst().orElseThrow();
        assertThat(score.title()).isEqualTo("Regolarità del sonno");
        assertThat(score.value()).isEqualTo(82);
        assertThat(score.zone()).isEqualTo("buono");
    }

    @Test
    void itAlwaysSaysTheyAreHabitSuggestionsNotMedicalAdvice() {
        assertThat(titles(run(nights(180, 180, 180, 180)))).contains((String) null);
        Card.Text note = (Card.Text) run(nights(180, 180, 180, 180)).cards().stream()
                .filter(c -> c instanceof Card.Text t && t.title() == null).findFirst().orElseThrow();
        assertThat(note.body()).contains("non consigli medici");
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    @Test
    void onTargetTheHeadlineSaysInLine() {
        assertThat(headline(run(nights(180, 180, 180, 180, 180)))).isEqualTo(new PluginResult.Headline("In linea", null));
    }

    @Test
    void theHeadlineGivesTheShiftAndALateShiftAsksForALook() {
        assertThat(headline(run(nights(205, 205, 205, 205)))).isEqualTo(new PluginResult.Headline("+25 min dall'obiettivo", null));
        assertThat(headline(run(nights(210, 210, 210, 210)))).isEqualTo(new PluginResult.Headline("+30 min dall'obiettivo", "attenzione"));
        assertThat(headline(run(nights(225, 225, 225, 225)))).isEqualTo(new PluginResult.Headline("+45 min dall'obiettivo", "attenzione"));
    }

    @Test
    void anEarlyShiftHasNoToneAndAProperMinusSign() {
        assertThat(headline(run(nights(120, 120, 120, 120)))).isEqualTo(new PluginResult.Headline("−60 min dall'obiettivo", null));
    }

    @Test
    void aBigVariationAloneDoesNotChangeTheHeadline() {
        assertThat(headline(run(nights(90, 270, 90, 270)))).isEqualTo(new PluginResult.Headline("In linea", null));
    }

    @Test
    void withFewerThanFourNightsThereIsNoHeadline() {
        assertThat(run(nights(180, 180, 180)).headline()).isNull();
    }

    @Test
    void itIsAWeeklyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("weekly");
    }

    @Test
    void theIdAndNameMatchWhatThePhoneShows() {
        assertThat(plugin.id()).isEqualTo("circadian");
        assertThat(plugin.manifest().name()).isEqualTo("Ritmo circadiano");
        assertThat(plugin.manifest().entities()).isEmpty();
    }
}
