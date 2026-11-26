package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.weather.UvReading;

/** Vitamina D (ADR 0031). Letture UV sintetiche; a Roma le 13:00 locali del 4 novembre sono le 12:00 UTC. */
class VitaminDPluginTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");

    private final VitaminDPlugin plugin = new VitaminDPlugin();

    private PluginResult run(List<UvReading> readings, Map<String, Object> chosen) {
        PluginContext context = new PluginContext(
                "dev", TODAY, NOW, ZONE, plugin.manifest().complete(chosen), (d, f, t) -> List.of(), null,
                at -> OptionalDouble.empty(),
                (from, to) -> readings.stream().filter(r -> !r.at().isBefore(from) && r.at().isBefore(to)).toList());
        return plugin.evaluate(context, TODAY);
    }

    private static List<String> texts(PluginResult result) {
        return result.cards().stream().filter(Card.Text.class::isInstance).map(c -> ((Card.Text) c).body()).toList();
    }

    private static Card.ListCard list(PluginResult result, String title) {
        return result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast)
                .filter(c -> c.title().equals(title)).findFirst().orElseThrow();
    }

    private static String row(Card.ListCard card, String label) {
        return card.rows().stream().filter(r -> r.label().equals(label)).map(Card.Row::value).findFirst().orElseThrow();
    }

    @Test
    void minutesFollowTheErythemalDoseOfTheSkinType() {
        // Fototipo 3 (300 J/m²) con UV 6: 300 / 9 = 33,3 minuti alla scottatura, un quarto per la vitamina D.
        assertThat(VitaminDPlugin.minutesToBurn(6, 3)).isCloseTo(33.33, org.assertj.core.data.Offset.offset(0.01));
        assertThat(VitaminDPlugin.minutesForVitaminD(6, 3)).isCloseTo(8.33, org.assertj.core.data.Offset.offset(0.01));
        assertThat(VitaminDPlugin.rough(8.33)).isEqualTo(8);
        assertThat(VitaminDPlugin.rough(33.3)).isEqualTo(35);
        assertThat(VitaminDPlugin.rough(0.2)).isEqualTo(1);
        assertThat(VitaminDPlugin.format(4.5)).isEqualTo("4,5");
        assertThat(VitaminDPlugin.format(5.0)).isEqualTo("5");
    }

    @Test
    void withoutUvReadingsItSaysHowToGetThem() {
        PluginResult result = run(List.of(), Map.of());
        assertThat(result.cards()).hasSize(1);
        assertThat(texts(result).get(0)).contains("uv_entity").contains("uv_index");
    }

    @Test
    void inTheMorningYesterdaysPeakIsTheReference() {
        Instant yesterdayNoon = Instant.parse("2026-11-03T12:00:00Z");
        PluginResult result = run(
                List.of(new UvReading(yesterdayNoon.minus(Duration.ofHours(3)), 2), new UvReading(yesterdayNoon, 6),
                        new UvReading(NOW.minus(Duration.ofHours(1)), 1)),
                Map.of());
        assertThat(texts(result).get(0)).contains("UV 6 (il picco di ieri)").contains("circa 8 minuti").contains("circa 35 minuti");
        Card.ListCard uv = list(result, "Indice UV");
        assertThat(row(uv, "Picco di ieri")).isEqualTo("UV 6 alle 13:00");
        assertThat(row(uv, "Oggi finora")).isEqualTo("UV 1 alle 08:00");
        assertThat(row(uv, "Fototipo")).isEqualTo("3");
    }

    @Test
    void underUvThreeItSaysTheSkinMakesLittleVitaminD() {
        PluginResult result = run(List.of(new UvReading(Instant.parse("2026-11-03T12:00:00Z"), 1.5)), Map.of());
        assertThat(texts(result).get(0)).contains("UV 1,5").contains("poca vitamina D");
    }

    @Test
    void aDarkerSkinTypeNeedsMoreTime() {
        PluginResult light = run(List.of(new UvReading(NOW.minus(Duration.ofMinutes(30)), 7)), Map.of("skinType", 1));
        PluginResult dark = run(List.of(new UvReading(NOW.minus(Duration.ofMinutes(30)), 7)), Map.of("skinType", 6));
        assertThat(row(list(light, "Minuti al sole per fototipo 1"), "UV 7")).isEqualTo("vitamina D 5 min · scottatura dopo 20 min");
        assertThat(row(list(dark, "Minuti al sole per fototipo 6"), "UV 7")).isEqualTo("vitamina D 25 min · scottatura dopo 95 min");
        assertThat(texts(light).get(0)).contains("(il picco di oggi)");
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    @Test
    void theHeadlineGivesTheMinutesForVitaminDOfTheReference() {
        Instant yesterdayNoon = Instant.parse("2026-11-03T12:00:00Z");
        PluginResult result = run(List.of(new UvReading(yesterdayNoon, 6), new UvReading(NOW.minus(Duration.ofHours(1)), 1)), Map.of());
        assertThat(headline(result)).isEqualTo(new PluginResult.Headline("8 min di sole", null));
        PluginResult dark = run(List.of(new UvReading(NOW.minus(Duration.ofMinutes(30)), 7)), Map.of("skinType", 6));
        assertThat(headline(dark).value()).isEqualTo("25 min di sole");
    }

    @Test
    void underUvThreeTheHeadlineSaysTheUvIsLow() {
        PluginResult result = run(List.of(new UvReading(Instant.parse("2026-11-03T12:00:00Z"), 2.9)), Map.of());
        assertThat(headline(result)).isEqualTo(new PluginResult.Headline("UV basso oggi", null));
    }

    @Test
    void withoutUvReadingsThereIsNoHeadline() {
        assertThat(run(List.of(), Map.of()).headline()).isNull();
    }

    @Test
    void itIsADailyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("daily");
    }

    @Test
    void theSkinTypeIsLimitedToOneToSix() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> plugin.manifest().complete(Map.of("skinType", 7)))
                .isInstanceOf(com.ringlife.backend.common.ApiException.class);
    }
}
