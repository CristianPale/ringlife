package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.plugin.PluginManifest.Field;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class CardAndManifestTest {

    private final ObjectMapper json = new ObjectMapper();

    // --- card ---

    @Test
    void everyCardTypeIsWrittenWithItsTypeName() {
        PluginResult result = new PluginResult(
                List.of(
                        new Card.Score("Sonno", 80, "buono", "ok"),
                        new Card.Trend("Passi", Arrays.asList(1.0, null, 3.0), "passi", null),
                        new Card.ListCard("Riepilogo", List.of(new Card.Row("Giorni", "7"))),
                        new Card.Text(null, "Un testo"),
                        new Card.Action("Apri il diario", "open-diary")),
                List.of(new PluginResult.Insight("info", "Titolo", "Testo")));
        JsonNode tree = json.readTree(json.writeValueAsString(result));
        List<String> types = tree.get("cards").valueStream().map(c -> c.get("type").asString()).toList();
        assertThat(types).containsExactly("score", "trend", "list", "text", "action");
        assertThat(tree.get("cards").get(1).get("points").get(1).isNull()).isTrue();
        assertThat(tree.get("insights").get(0).get("level").asString()).isEqualTo("info");
    }

    @Test
    void aScoreOutsideItsLimitsOrWithAnUnknownZoneIsRefused() {
        assertThatThrownBy(() -> new Card.Score("x", 101, "buono", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Card.Score("x", -1, "buono", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Card.Score("x", 50, "rosso", null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void anActionMustBeOneOfTheAppsOwnNeverAWebAddress() {
        assertThatThrownBy(() -> new Card.Action("Apri", "https://example.org")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Card.Action("Apri", "javascript:alert(1)")).isInstanceOf(IllegalArgumentException.class);
        new Card.Action("Apri", "log-headache");
    }

    @Test
    void emptyTextIsRefused() {
        assertThatThrownBy(() -> new Card.Text("t", " ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Card.Score(" ", 50, "buono", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginResult.Insight("grave", "t", "x")).isInstanceOf(IllegalArgumentException.class);
    }

    // --- headline (ADR 0041) ---

    @Test
    void theHeadlineIsWrittenInsideTheResultAndIsNullWhenThereIsNone() {
        PluginResult with = new PluginResult(List.of(new Card.Text(null, "Un testo")), List.of())
                .withHeadline(PluginResult.Headline.of("Rischio basso"));
        JsonNode tree = json.readTree(json.writeValueAsString(with));
        assertThat(tree.get("headline").get("value").asString()).isEqualTo("Rischio basso");
        assertThat(tree.get("headline").has("tone")).isTrue();
        assertThat(tree.get("headline").get("tone").isNull()).isTrue();

        JsonNode attention = json.readTree(json.writeValueAsString(
                new PluginResult(List.of(), List.of(), List.of(), PluginResult.Headline.attention("Rischio alto"))));
        assertThat(attention.get("headline").get("tone").asString()).isEqualTo("attenzione");

        JsonNode without = json.readTree(json.writeValueAsString(new PluginResult(List.of(new Card.Text(null, "Un testo")), List.of())));
        assertThat(without.has("headline")).isTrue();
        assertThat(without.get("headline").isNull()).isTrue();
    }

    // --- alerts (ADR 0045) ---

    @Test
    void alertsAreLeftOutOfTheJsonWhenThereAreNoneAndWrittenWhenThereAre() {
        JsonNode without = json.readTree(json.writeValueAsString(new PluginResult(List.of(new Card.Text(null, "Un testo")), List.of())));
        assertThat(without.has("alerts")).isFalse();

        PluginResult with = PluginResult.EMPTY.withHeadline(PluginResult.Headline.of("Rischio alto"))
                .withAlerts(List.of(new PluginResult.Alert("migraine-risk", "Titolo", "Testo", java.util.Map.of("score", 70))));
        JsonNode tree = json.readTree(json.writeValueAsString(with));
        assertThat(tree.get("alerts").get(0).get("rule").asString()).isEqualTo("migraine-risk");
        assertThat(tree.get("alerts").get(0).get("values").get("score").asInt()).isEqualTo(70);
        assertThat(tree.get("headline").get("value").asString()).isEqualTo("Rischio alto");
        assertThat(with.isEmpty()).isFalse();
        assertThat(with.withHeadline(null).headline()).isNull();
        assertThat(with.withHeadline(null).alerts()).hasSize(1);
    }

    @Test
    void theOlderConstructorsHaveNoAlertsAndABlankAlertIsRefused() {
        assertThat(new PluginResult(List.of(), List.of()).alerts()).isEmpty();
        assertThat(new PluginResult(List.of(), List.of(), List.of(), null).alerts()).isEmpty();
        assertThat(PluginResult.EMPTY.withAlerts(List.of(new PluginResult.Alert("r", "t", "b", null))).isEmpty()).isFalse();
        assertThatThrownBy(() -> new PluginResult.Alert(" ", "t", "b", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginResult.Alert("r", "", "b", null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void theOlderConstructorsHaveNoHeadline() {
        assertThat(new PluginResult(List.of(), List.of()).headline()).isNull();
        assertThat(new PluginResult(List.of(), List.of(), List.of()).headline()).isNull();
        assertThat(PluginResult.EMPTY.headline()).isNull();
        assertThat(PluginResult.EMPTY.isEmpty()).isTrue();
        assertThat(PluginResult.EMPTY.withHeadline(PluginResult.Headline.of("x")).isEmpty()).isFalse();
    }

    @Test
    void aBlankHeadlineOrAnUnknownToneIsRefused() {
        assertThatThrownBy(() -> new PluginResult.Headline(" ", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginResult.Headline(null, null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginResult.Headline("Rischio alto", "rosso")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginResult.Headline("Rischio alto", "info")).isInstanceOf(IllegalArgumentException.class);
        assertThat(PluginResult.Headline.of("x", true).tone()).isEqualTo("attenzione");
        assertThat(PluginResult.Headline.of("x", false).tone()).isNull();
    }

    // --- manifest ---

    @Test
    void theCadenceIsWrittenInTheManifestAndTheOlderConstructorsDefaultToDaily() {
        assertThat(manifest.cadence()).isEqualTo("daily");
        assertThat(new PluginManifest("demo", "Demo", "x", "1", List.of(), List.of(), List.of()).cadence()).isEqualTo("daily");
        PluginManifest weekly = new PluginManifest("demo", "Demo", "x", "1", List.of(), List.of(), List.of(), PluginManifest.WEEKLY);
        assertThat(json.readTree(json.writeValueAsString(weekly)).get("cadence").asString()).isEqualTo("weekly");
    }

    @Test
    void anUnknownCadenceIsRefused() {
        assertThatThrownBy(() -> new PluginManifest("demo", "Demo", "x", "1", List.of(), List.of(), List.of(), "monthly"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PluginManifest("demo", "Demo", "x", "1", List.of(), List.of(), List.of(), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private final PluginManifest manifest = new PluginManifest(
            "demo", "Demo", "Un plugin di prova", "1", List.of(),
            List.of(
                    Field.integer("hours", "Ore", 8, 1, 12),
                    Field.bool("loud", "Rumoroso", false),
                    Field.time("wake", "Risveglio", "07:00")));

    @Test
    void theManifestFillsInTheDefaultsAndKeepsWhatWasChosen() {
        assertThat(manifest.complete(Map.of())).containsEntry("hours", 8).containsEntry("loud", false).containsEntry("wake", "07:00");
        assertThat(manifest.complete(Map.of("hours", 6, "wake", "06:30")))
                .containsEntry("hours", 6).containsEntry("wake", "06:30").containsEntry("loud", false);
    }

    @Test
    void anUnknownKeyAWrongTypeOrAValueOutOfRangeIsRefused() {
        for (Map<String, Object> bad : List.<Map<String, Object>>of(
                Map.of("nope", 1),
                Map.of("hours", 13),
                Map.of("hours", 0),
                Map.of("hours", "8"),
                Map.of("hours", 8.5),
                Map.of("loud", "yes"),
                Map.of("wake", "7:00"),
                Map.of("wake", "25:00"),
                Map.of("wake", 700))) {
            assertThatThrownBy(() -> manifest.complete(bad)).as(bad.toString()).isInstanceOf(ApiException.class);
        }
    }
}
