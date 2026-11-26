package com.ringlife.backend.ha;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.compute.LatestResults.Latest;
import com.ringlife.backend.compute.LatestResults.Metric;
import com.ringlife.backend.compute.LatestResults.Score;
import com.ringlife.backend.ha.HaEntities.Definition;
import com.ringlife.backend.ha.HaEntities.Message;
import com.ringlife.backend.plugin.PluginManifest.EntityDef;
import com.ringlife.backend.plugin.PluginResult.EntityState;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class HaEntitiesTest {

    private final ObjectMapper json = new ObjectMapper();

    private static Latest empty() {
        return new Latest("dev", java.time.LocalDate.of(2026, 11, 4), Map.of(), Map.of(), Map.of(), null, null, null, null);
    }

    private static Latest full() {
        return new Latest(
                "dev",
                java.time.LocalDate.of(2026, 11, 4),
                Map.of(
                        "sleep", new Score("2026-11-04", 82, "v1", "[{\"id\":\"sleep-duration\",\"weight\":0.3,\"score\":90}]"),
                        "recovery", new Score("2026-11-04", 71, "v1", "[]"),
                        "movement", new Score("2026-11-03", 64, "v1", "[]"),
                        "stress", new Score("2026-11-03", 90, "v1", "[]")),
                Map.of("sleep_debt", new Metric("2026-11-04", 4.1666), "temp_deviation", new Metric("2026-11-04", 0.254)),
                Map.of("resting_hr", 56.4, "hrv_night", 46.6),
                1240.0,
                Instant("2026-11-03T22:30:00Z"),
                Instant("2026-11-04T06:15:00Z"),
                Instant("2026-11-04T07:41:00Z"));
    }

    private static long Instant(String iso) {
        return java.time.Instant.parse(iso).toEpochMilli();
    }

    private static Map<String, String> byTopic(List<Message> messages) {
        return messages.stream().collect(java.util.stream.Collectors.toMap(Message::topic, Message::payload));
    }

    private Definition def(String key) {
        return HaEntities.ALL.stream().filter(d -> d.key().equals(key)).findFirst().orElseThrow();
    }

    @Test
    void definesTheTwelveEntitiesWithStableUniqueIds() {
        assertThat(HaEntities.ALL).extracting(Definition::key).containsExactly(
                "sleep_index", "movement_index", "recovery_score", "stress_rhythm", "sleep_debt", "resting_hr", "hrv",
                "temp_deviation", "sleep_start", "sleep_end", "steps_today", "last_sync");
        assertThat(new HashSet<>(HaEntities.ALL.stream().map(Definition::key).toList())).hasSize(12);
    }

    @Test
    void doesNotPublishWhatHasNoRealDataYet() {
        assertThat(HaEntities.ALL).extracting(Definition::key).doesNotContain("battery", "migraine_risk");
    }

    @Test
    void discoveryConfigsAreRetainedAndLinkedToOneDevice() throws Exception {
        List<Message> configs = HaEntities.configs("homeassistant");
        assertThat(configs).hasSize(12).allMatch(Message::retained);
        for (Message message : configs) {
            JsonNode config = json.readTree(message.payload());
            assertThat(message.topic()).startsWith("homeassistant/sensor/ringlife/").endsWith("/config");
            assertThat(config.get("unique_id").asText()).startsWith("ringlife_");
            // L'entita' si chiama sensor.ringlife_<chiave>: e' il contratto con le automazioni di casa.
            assertThat(config.get("default_entity_id").asText()).isEqualTo("sensor." + config.get("unique_id").asText());
            assertThat(config.get("availability_topic").asText()).isEqualTo("ringlife/availability");
            assertThat(config.get("device").get("identifiers").get(0).asText()).isEqualTo("ringlife");
            assertThat(config.get("device").get("name").asText()).isEqualTo("RingLife");
            assertThat(config.get("state_topic").asText()).startsWith("ringlife/").endsWith("/state");
        }
    }

    @Test
    void usesTheDiscoveryPrefixFromSettings() {
        assertThat(HaEntities.configTopic("casa", def("hrv"))).isEqualTo("casa/sensor/ringlife/hrv/config");
    }

    @Test
    void sensorsCarryUnitsAndClasses() throws Exception {
        JsonNode debt = json.readTree(HaEntities.config("homeassistant", def("sleep_debt")).payload());
        assertThat(debt.get("unit_of_measurement").asText()).isEqualTo("h");
        assertThat(debt.get("device_class").asText()).isEqualTo("duration");
        assertThat(debt.get("state_class").asText()).isEqualTo("measurement");
        JsonNode start = json.readTree(HaEntities.config("homeassistant", def("sleep_start")).payload());
        assertThat(start.get("device_class").asText()).isEqualTo("timestamp");
        assertThat(start.has("state_class")).isFalse();
        assertThat(start.has("unit_of_measurement")).isFalse();
        JsonNode hr = json.readTree(HaEntities.config("homeassistant", def("resting_hr")).payload());
        assertThat(hr.get("unit_of_measurement").asText()).isEqualTo("bpm");
        // Il nome esteso accanto alla sigla, come nell'app.
        assertThat(def("hrv").name()).contains("Variabilità cardiaca").contains("HRV");
    }

    @Test
    void onlyTheIndicesHaveAttributes() throws Exception {
        for (Definition d : HaEntities.ALL) {
            JsonNode config = json.readTree(HaEntities.config("homeassistant", d).payload());
            assertThat(config.has("json_attributes_topic")).isEqualTo(d.attributes());
        }
        assertThat(HaEntities.ALL.stream().filter(Definition::attributes).map(Definition::key))
                .containsExactly("sleep_index", "movement_index", "recovery_score", "stress_rhythm");
    }

    @Test
    void statesComeFromTheLatestResults() {
        Map<String, String> states = byTopic(HaEntities.states(full()));
        assertThat(states).containsEntry("ringlife/sleep_index/state", "82")
                .containsEntry("ringlife/recovery_score/state", "71")
                // Gli indici di ieri restano finche' oggi non ce n'e' uno nuovo.
                .containsEntry("ringlife/movement_index/state", "64")
                .containsEntry("ringlife/stress_rhythm/state", "90")
                .containsEntry("ringlife/sleep_debt/state", "4.17")
                .containsEntry("ringlife/temp_deviation/state", "0.25")
                .containsEntry("ringlife/resting_hr/state", "56")
                .containsEntry("ringlife/hrv/state", "47")
                .containsEntry("ringlife/steps_today/state", "1240")
                .containsEntry("ringlife/sleep_start/state", "2026-11-03T22:30:00Z")
                .containsEntry("ringlife/sleep_end/state", "2026-11-04T06:15:00Z")
                .containsEntry("ringlife/last_sync/state", "2026-11-04T07:41:00Z");
    }

    @Test
    void anEntityWithoutDataPublishesNoneInsteadOfAMadeUpValue() {
        Map<String, String> states = byTopic(HaEntities.states(empty()));
        for (Definition d : HaEntities.ALL) {
            assertThat(states).containsEntry(HaEntities.stateTopic(d), "None");
        }
    }

    @Test
    void indicesPublishDayVersionAndComponentsAsAttributes() throws Exception {
        Map<String, String> states = byTopic(HaEntities.states(full()));
        JsonNode attributes = json.readTree(states.get("ringlife/sleep_index/attributes"));
        assertThat(attributes.get("day").asText()).isEqualTo("2026-11-04");
        assertThat(attributes.get("algo_version").asText()).isEqualTo("v1");
        assertThat(attributes.get("components").get(0).get("id").asText()).isEqualTo("sleep-duration");
        assertThat(attributes.get("components").get(0).get("score").asInt()).isEqualTo(90);
    }

    @Test
    void anIndexWithoutDataPublishesEmptyAttributes() {
        assertThat(byTopic(HaEntities.states(empty())).get("ringlife/recovery_score/attributes")).isEqualTo("{}");
    }

    @Test
    void stateMessagesAreRetainedSoHomeAssistantKeepsThemAfterARestart() {
        assertThat(HaEntities.states(full())).allMatch(Message::retained);
    }

    // --- entita' dei plugin (ADR 0014) ---

    private static final EntityDef MIGRAINE = new EntityDef("migraine_risk", "Rischio emicrania", "mdi:head-alert", List.of("low", "medium", "high"));

    @Test
    void aPluginEntityIsAnEnumSensorWithItsOptionsAndAttributes() {
        HaEntities.Message config = HaEntities.pluginConfigs("homeassistant", List.of(MIGRAINE)).get(0);
        assertThat(config.topic()).isEqualTo("homeassistant/sensor/ringlife/migraine_risk/config");
        assertThat(config.retained()).isTrue();
        JsonNode tree = json.readTree(config.payload());
        assertThat(tree.get("unique_id").asString()).isEqualTo("ringlife_migraine_risk");
        assertThat(tree.get("default_entity_id").asString()).isEqualTo("sensor.ringlife_migraine_risk");
        assertThat(tree.get("device_class").asString()).isEqualTo("enum");
        assertThat(tree.get("options").valueStream().map(o -> o.asString()).toList()).containsExactly("low", "medium", "high");
        assertThat(tree.get("json_attributes_topic").asString()).isEqualTo("ringlife/migraine_risk/attributes");
        assertThat(tree.has("unit_of_measurement")).isFalse();
        assertThat(tree.get("device").get("identifiers").get(0).asString()).isEqualTo("ringlife");
    }

    @Test
    void aPluginEntityWithoutAStateIsUnknownAndWithOneCarriesItsAttributes() {
        List<HaEntities.Message> none = HaEntities.pluginStates(List.of(MIGRAINE), Map.of());
        assertThat(none).extracting(HaEntities.Message::payload).containsExactly("None", "{}");

        List<HaEntities.Message> some = HaEntities.pluginStates(
                List.of(MIGRAINE), Map.of("migraine_risk", new EntityState("migraine_risk", "high", Map.of("score", 70))));
        assertThat(some.get(0).topic()).isEqualTo("ringlife/migraine_risk/state");
        assertThat(some.get(0).payload()).isEqualTo("high");
        assertThat(some.get(1).topic()).isEqualTo("ringlife/migraine_risk/attributes");
        assertThat(some.get(1).payload()).contains("\"score\":70");

        List<HaEntities.Message> unknownState = HaEntities.pluginStates(
                List.of(MIGRAINE), Map.of("migraine_risk", new EntityState("migraine_risk", null, Map.of())));
        assertThat(unknownState.get(0).payload()).isEqualTo("None");
    }
}
