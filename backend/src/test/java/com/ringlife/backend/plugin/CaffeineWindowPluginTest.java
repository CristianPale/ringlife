package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.diary.DiaryLog;

/** Finestra caffeina (ADR 0016). */
class CaffeineWindowPluginTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Instant NOW = Instant.parse("2026-11-04T18:00:00Z");

    private final CaffeineWindowPlugin plugin = new CaffeineWindowPlugin();

    private static DiaryLog diary(List<DiaryLog.Drink> drinks) {
        return new DiaryLog() {
            @Override
            public List<Drink> drinks(String deviceId, long fromMs, long toMs) {
                return drinks.stream().filter(d -> d.ts() >= fromMs && d.ts() < toMs).toList();
            }

            @Override
            public List<Headache> headaches(String deviceId, long fromMs, long toMs) {
                return List.of();
            }

            @Override
            public List<HeadacheDetails> headacheDetails(String deviceId, long fromMs, long toMs) {
                return List.of();
            }

            @Override
            public boolean hasDrinkEntriesSince(String deviceId, long fromMs) {
                return !drinks.isEmpty();
            }
        };
    }

    private PluginResult run(Map<String, Object> chosen, List<DiaryLog.Drink> drinks) {
        PluginContext context = new PluginContext(
                "dev", TODAY, NOW, ZONE, plugin.manifest().complete(chosen), (d, f, t) -> List.of(), diary(drinks));
        return plugin.evaluate(context, TODAY);
    }

    private static long at(int hour, int minute) {
        return TODAY.atTime(hour, minute).atZone(ZONE).toInstant().toEpochMilli();
    }

    private static Card.ListCard window(PluginResult result) {
        return result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast).findFirst().orElseThrow();
    }

    private static String row(Card.ListCard card, String label) {
        return card.rows().stream().filter(r -> r.label().equals(label)).map(Card.Row::value).findFirst().orElseThrow();
    }

    @Test
    void theDefaultsGiveTheWindowFromHalfPastEightToThreeInTheAfternoon() {
        Card.ListCard card = window(run(Map.of(), List.of()));
        assertThat(row(card, "Da")).isEqualTo("08:30");
        assertThat(row(card, "Fino alle")).isEqualTo("15:00");
        assertThat(row(card, "Coricarsi")).isEqualTo("23:00");
    }

    @Test
    void theWindowFollowsTheWakeTimeTheSleepGoalAndTheCutoff() {
        Card.ListCard card = window(run(Map.of("wakeTime", "06:00", "sleepGoalHours", 7, "delayMinutes", 60, "cutoffHours", 6), List.of()));
        // Coricarsi: 06:00 - 7 h = 23:00; stop 17:00; inizio 07:00.
        assertThat(row(card, "Da")).isEqualTo("07:00");
        assertThat(row(card, "Fino alle")).isEqualTo("17:00");
        assertThat(row(card, "Coricarsi")).isEqualTo("23:00");
    }

    @Test
    void aLateRiserGetsATimeAfterMidnightFormattedOnTheClock() {
        // Risveglio 11:00, obiettivo 5 h: si va a letto alle 06:00 (dopo la mezzanotte); stop 22:00.
        Card.ListCard card = window(run(Map.of("wakeTime", "11:00", "sleepGoalHours", 5, "cutoffHours", 8), List.of()));
        assertThat(row(card, "Coricarsi")).isEqualTo("06:00");
        assertThat(row(card, "Fino alle")).isEqualTo("22:00");
    }

    @Test
    void anEmptyWindowIsSaidNotInvented() {
        // Sonno 10 h, stop 12 h prima: coricarsi 21:00, stop 09:00, inizio 07:00 + 180 min = 10:00: finisce prima di iniziare.
        PluginResult result = run(Map.of("sleepGoalHours", 10, "delayMinutes", 180, "cutoffHours", 12), List.of());
        assertThat(result.cards()).hasSize(1);
        assertThat(((Card.Text) result.cards().get(0)).body()).contains("la finestra è vuota");
        assertThat(result.cards().stream().anyMatch(Card.ListCard.class::isInstance)).isFalse();
    }

    @Test
    void itNeverSaysWhetherNowIsInsideTheWindow() {
        PluginResult result = run(Map.of(), List.of());
        String all = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).map(Card.Text::body).reduce("", String::concat);
        assertThat(all).doesNotContain("adesso").doesNotContain("ora puoi");
        assertThat(all).contains("non da evidenze");
        assertThat(all).contains("non consigli medici");
    }

    @Test
    void caffeineLoggedAfterTheEndOfTheWindowIsNoted() {
        PluginResult result = run(Map.of(), List.of(new DiaryLog.Drink(at(9, 0), "caffeine"), new DiaryLog.Drink(at(16, 20), "caffeine")));
        assertThat(result.insights()).hasSize(1);
        assertThat(result.insights().get(0).text()).isEqualTo("Oggi hai segnato caffeina alle 16:20, dopo le 15:00.");
    }

    @Test
    void caffeineInsideTheWindowAndAlcoholAreNotNoted() {
        PluginResult inside = run(Map.of(), List.of(new DiaryLog.Drink(at(9, 0), "caffeine"), new DiaryLog.Drink(at(15, 0), "caffeine")));
        assertThat(inside.insights()).isEmpty();
        PluginResult alcohol = run(Map.of(), List.of(new DiaryLog.Drink(at(21, 0), "alcohol")));
        assertThat(alcohol.insights()).isEmpty();
    }

    @Test
    void caffeineFromAnotherDayIsIgnored() {
        long yesterday = TODAY.minusDays(1).atTime(20, 0).atZone(ZONE).toInstant().toEpochMilli();
        assertThat(run(Map.of(), List.of(new DiaryLog.Drink(yesterday, "caffeine"))).insights()).isEmpty();
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    @Test
    void theHeadlineIsTheWindowFromStartToStop() {
        assertThat(headline(run(Map.of(), List.of()))).isEqualTo(new PluginResult.Headline("08:30 – 15:00", null));
        PluginResult custom = run(Map.of("wakeTime", "06:00", "sleepGoalHours", 7, "delayMinutes", 60, "cutoffHours", 6), List.of());
        assertThat(headline(custom).value()).isEqualTo("07:00 – 17:00");
    }

    @Test
    void caffeineAfterTheWindowDoesNotChangeTheHeadline() {
        PluginResult result = run(Map.of(), List.of(new DiaryLog.Drink(at(16, 20), "caffeine")));
        assertThat(headline(result)).isEqualTo(new PluginResult.Headline("08:30 – 15:00", null));
    }

    @Test
    void anEmptyWindowAsksForALook() {
        PluginResult result = run(Map.of("sleepGoalHours", 10, "delayMinutes", 180, "cutoffHours", 12), List.of());
        assertThat(headline(result)).isEqualTo(new PluginResult.Headline("Finestra vuota", "attenzione"));
    }

    @Test
    void itIsADailyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("daily");
    }

    @Test
    void itHasNoHomeAssistantEntityAndDeclaresItsParameters() {
        assertThat(plugin.manifest().entities()).isEmpty();
        assertThat(plugin.manifest().config()).extracting(PluginManifest.Field::key)
                .containsExactly("wakeTime", "sleepGoalHours", "delayMinutes", "cutoffHours");
        assertThat(plugin.id()).isEqualTo("caffeine-window");
    }
}
