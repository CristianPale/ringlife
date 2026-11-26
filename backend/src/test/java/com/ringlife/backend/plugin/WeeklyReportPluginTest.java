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

/** Report settimanale su giornate sintetiche. */
class WeeklyReportPluginTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);

    private final WeeklyReportPlugin plugin = new WeeklyReportPlugin();

    /** Una storia in memoria: il filtro per intervallo lo fa il plugin come lo farebbe il lettore vero. */
    private static History history(List<DayResults> days) {
        return (device, from, to) -> days.stream().filter(d -> !d.day().isBefore(from) && !d.day().isAfter(to)).toList();
    }

    private static DayResults day(int daysAgo, String kind, int value) {
        return new DayResults(TODAY.minusDays(daysAgo), Map.of(kind, value), Map.of(), Map.of());
    }

    private PluginResult run(List<DayResults> days) {
        PluginContext context = new PluginContext("dev", TODAY, Instant.parse("2026-11-04T08:00:00Z"), ZoneId.of("Europe/Rome"), Map.of(), history(days), null);
        return plugin.evaluate(context, TODAY);
    }

    /** Un indice costante per `count` giorni a partire da `firstDaysAgo`. */
    private static List<DayResults> steady(String kind, int value, int firstDaysAgo, int count) {
        List<DayResults> days = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            days.add(day(firstDaysAgo + i, kind, value));
        }
        return days;
    }

    private static Card.Score score(PluginResult result, String title) {
        return result.cards().stream()
                .filter(Card.Score.class::isInstance)
                .map(Card.Score.class::cast)
                .filter(c -> c.title().equals(title))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void averagesTheLastSevenFinishedDaysAndComparesThemWithTheSevenBefore() {
        List<DayResults> days = new ArrayList<>();
        days.addAll(steady("sleep", 80, 1, 7));
        days.addAll(steady("sleep", 70, 8, 7));
        PluginResult result = run(days);

        Card.Score sleep = score(result, "Sonno");
        assertThat(sleep.value()).isEqualTo(80);
        assertThat(sleep.zone()).isEqualTo("buono");
        assertThat(sleep.caption()).contains("+10").contains("settimana prima");
        assertThat(result.insights()).hasSize(1);
        assertThat(result.insights().get(0).title()).contains("Sonno").contains("migliore");
    }

    @Test
    void todayIsNeverCounted() {
        List<DayResults> days = new ArrayList<>(steady("sleep", 80, 1, 7));
        days.add(day(0, "sleep", 10));
        assertThat(score(run(days), "Sonno").value()).isEqualTo(80);
    }

    @Test
    void anIndexWithTooFewDaysIsLeftOut() {
        List<DayResults> days = new ArrayList<>();
        days.addAll(steady("sleep", 80, 1, 2));
        days.addAll(steady("recovery", 90, 1, 3));
        PluginResult result = run(days);
        assertThat(result.cards()).hasSize(1);
        assertThat(score(result, "Recupero").zone()).isEqualTo("ottimo");
    }

    @Test
    void withoutEnoughDaysBeforeItStillShowsTheWeekAndSaysWhy() {
        PluginResult result = run(steady("movement", 60, 1, 5));
        Card.Score movement = score(result, "Movimento");
        assertThat(movement.zone()).isEqualTo("attenzione");
        assertThat(movement.caption()).contains("Ancora pochi giorni");
        assertThat(result.insights()).isEmpty();
    }

    @Test
    void aSmallChangeGetsNoComment() {
        List<DayResults> days = new ArrayList<>();
        days.addAll(steady("sleep", 75, 1, 7));
        days.addAll(steady("sleep", 72, 8, 7));
        PluginResult result = run(days);
        assertThat(score(result, "Sonno").caption()).contains("+3");
        assertThat(result.insights()).isEmpty();
    }

    @Test
    void aDropIsCommentedAndUsesAProperMinusSign() {
        List<DayResults> days = new ArrayList<>();
        days.addAll(steady("recovery", 60, 1, 7));
        days.addAll(steady("recovery", 75, 8, 7));
        PluginResult result = run(days);
        assertThat(score(result, "Recupero").caption()).contains("−15");
        assertThat(result.insights().get(0).title()).contains("più bassa");
    }

    @Test
    void noDataGivesAnEmptyResultNotAnError() {
        assertThat(run(List.of()).isEmpty()).isTrue();
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    private static List<DayResults> twoWeeks(String kind, int thisWeek, int weekBefore) {
        List<DayResults> days = new ArrayList<>(steady(kind, thisWeek, 1, 7));
        days.addAll(steady(kind, weekBefore, 8, 7));
        return days;
    }

    @Test
    void theHeadlineGivesANotableRise() {
        assertThat(headline(run(twoWeeks("sleep", 80, 71)))).isEqualTo(new PluginResult.Headline("Sonno +9", null));
    }

    @Test
    void aNotableDropAsksForALook() {
        assertThat(headline(run(twoWeeks("recovery", 67, 75)))).isEqualTo(new PluginResult.Headline("Recupero −8", "attenzione"));
        assertThat(headline(run(twoWeeks("movement", 60, 75)))).isEqualTo(new PluginResult.Headline("Movimento −15", "attenzione"));
    }

    @Test
    void theLargestChangeWinsAndATieGoesToTheFirstCard() {
        List<DayResults> days = new ArrayList<>(twoWeeks("sleep", 80, 71));
        days.addAll(twoWeeks("recovery", 60, 72));
        assertThat(headline(run(days))).isEqualTo(new PluginResult.Headline("Recupero −12", "attenzione"));

        List<DayResults> tie = new ArrayList<>(twoWeeks("sleep", 80, 72));
        tie.addAll(twoWeeks("recovery", 67, 75));
        assertThat(headline(run(tie))).isEqualTo(new PluginResult.Headline("Recupero −8", "attenzione"));
    }

    @Test
    void smallChangesGiveAStableWeek() {
        List<DayResults> days = new ArrayList<>(twoWeeks("sleep", 75, 72));
        days.addAll(twoWeeks("recovery", 70, 77));
        assertThat(headline(run(days))).isEqualTo(new PluginResult.Headline("Settimana stabile", null));
    }

    @Test
    void withoutAWeekToCompareThereIsNoHeadline() {
        assertThat(run(steady("movement", 60, 1, 5)).headline()).isNull();
        assertThat(run(List.of()).headline()).isNull();
    }

    @Test
    void itIsAWeeklyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("weekly");
    }

    @Test
    void theManifestHasNoConfigAndAStableId() {
        assertThat(plugin.id()).isEqualTo("weekly-report");
        assertThat(plugin.manifest().id()).isEqualTo(plugin.id());
        assertThat(plugin.manifest().config()).isEmpty();
    }
}
