package com.ringlife.backend.ha;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.compute.LatestResults;
import com.ringlife.backend.plugin.PluginService;
import com.ringlife.backend.compute.LatestResults.Latest;
import com.ringlife.backend.compute.LatestResults.Score;

class HaPublisherTest {

    /** Un gateway che registra i messaggi e puo' fingere un broker spento o riavviato. */
    static class RecordingGateway implements MqttGateway {
        final List<String> topics = new ArrayList<>();
        final List<String> payloads = new ArrayList<>();
        boolean up = true;
        long connection = 1;

        @Override
        public boolean publish(String topic, String payload, boolean retained) {
            if (!up) {
                return false;
            }
            topics.add(topic);
            payloads.add(payload);
            return true;
        }

        @Override
        public long connectionId() {
            return connection;
        }

        long count(String suffix) {
            return topics.stream().filter(t -> t.endsWith(suffix)).count();
        }
    }

    private RecordingGateway gateway;
    private LatestResults results;
    private PluginService plugins;
    private AlertService alerts;
    private HaPublisher publisher;

    private static MqttSettings settings(String host) {
        return new MqttSettings(host, 1883, "", "", "homeassistant");
    }

    private static Latest latest(int recovery) {
        return new Latest("dev", LocalDate.of(2026, 11, 4), Map.of("recovery", new Score("2026-11-04", recovery, "v1", "[]")),
                Map.of(), Map.of(), null, null, null, null);
    }

    @BeforeEach
    void setUp() {
        gateway = new RecordingGateway();
        results = mock(LatestResults.class);
        plugins = mock(PluginService.class);
        alerts = mock(AlertService.class);
        when(results.of("dev")).thenReturn(latest(71));
        when(results.latestSyncedDevice()).thenReturn("dev");
        publisher = new HaPublisher(settings("broker"), gateway, results, plugins, alerts);
    }

    @Test
    void doesNothingWhenMqttIsOff() {
        publisher = new HaPublisher(settings(""), gateway, results, plugins, alerts);
        publisher.publish("dev");
        publisher.publishLatestDevice();
        assertThat(gateway.topics).isEmpty();
    }

    @Test
    void announcesBeforeSendingTheStates() {
        publisher.publish("dev");
        assertThat(gateway.topics.get(0)).isEqualTo("ringlife/availability");
        assertThat(gateway.payloads.get(0)).isEqualTo("online");
        assertThat(gateway.count("/config")).isEqualTo(12);
        int lastConfig = gateway.topics.lastIndexOf(gateway.topics.stream().filter(t -> t.endsWith("/config")).reduce((a, b) -> b).orElseThrow());
        int firstState = gateway.topics.indexOf("ringlife/recovery_score/state");
        assertThat(firstState).isGreaterThan(lastConfig);
        assertThat(gateway.payloads.get(firstState)).isEqualTo("71");
    }

    @Test
    void sendsTheConfigurationOnlyOncePerConnection() {
        publisher.publish("dev");
        publisher.publish("dev");
        assertThat(gateway.count("/config")).isEqualTo(12);
        assertThat(gateway.count("ringlife/recovery_score/state")).isEqualTo(2);
    }

    @Test
    void sendsTheConfigurationAgainAfterAReconnection() {
        publisher.publish("dev");
        gateway.connection = 2;
        publisher.publish("dev");
        assertThat(gateway.count("/config")).isEqualTo(24);
    }

    @Test
    void sendsNewStates() {
        publisher.publish("dev");
        when(results.of("dev")).thenReturn(latest(50));
        publisher.publish("dev");
        int last = gateway.topics.lastIndexOf("ringlife/recovery_score/state");
        assertThat(gateway.payloads.get(last)).isEqualTo("50");
    }

    @Test
    void aBrokerThatIsDownIsSkippedAndRetriedLater() {
        gateway.up = false;
        publisher.publish("dev");
        assertThat(gateway.topics).isEmpty();
        gateway.up = true;
        publisher.publish("dev");
        assertThat(gateway.count("/config")).isEqualTo(12);
    }

    @Test
    void neverThrowsWhateverGoesWrong() {
        when(results.of("dev")).thenThrow(new IllegalStateException("boom"));
        publisher.publish("dev");
        when(results.latestSyncedDevice()).thenThrow(new IllegalStateException("boom"));
        publisher.publishLatestDevice();
    }

    @Test
    void publishesTheLatestSyncedDevice() {
        publisher.publishLatestDevice();
        assertThat(gateway.count("ringlife/recovery_score/state")).isEqualTo(1);
    }

    @Test
    void publishesUnknownEntitiesWhenNoDeviceEverSynced() {
        when(results.latestSyncedDevice()).thenReturn(null);
        publisher.publishLatestDevice();
        assertThat(gateway.count("/config")).isEqualTo(12);
        assertThat(gateway.count("/state")).isEqualTo(12);
        assertThat(gateway.payloads.stream().filter("None"::equals).count()).isEqualTo(12);
    }

    @Test
    void publishesNothingWhenMqttIsOffAndNoDeviceEverSynced() {
        publisher = new HaPublisher(settings(""), gateway, results, plugins, alerts);
        when(results.latestSyncedDevice()).thenReturn(null);
        publisher.publishLatestDevice();
        assertThat(gateway.topics).isEmpty();
    }

    @Test
    void publishesTheEntitiesOfThePluginsWithTheirStates() {
        var migraine = new com.ringlife.backend.plugin.PluginManifest.EntityDef("migraine_risk", "Rischio emicrania", "mdi:head-alert", List.of("low", "medium", "high"));
        when(plugins.entityDefinitions()).thenReturn(List.of(migraine));
        when(plugins.entityStates("dev")).thenReturn(Map.of(
                "migraine_risk", new com.ringlife.backend.plugin.PluginResult.EntityState("migraine_risk", "medium", Map.of("score", 40))));
        publisher.publish("dev");
        assertThat(gateway.count("/config")).isEqualTo(13);
        int state = gateway.topics.indexOf("ringlife/migraine_risk/state");
        assertThat(gateway.payloads.get(state)).isEqualTo("medium");
    }

    @Test
    void thePluginEntitiesExistAsUnknownBeforeAnyDeviceSynced() {
        var migraine = new com.ringlife.backend.plugin.PluginManifest.EntityDef("migraine_risk", "Rischio emicrania", "mdi:head-alert", List.of("low", "medium", "high"));
        when(plugins.entityDefinitions()).thenReturn(List.of(migraine));
        when(results.latestSyncedDevice()).thenReturn(null);
        publisher.publishLatestDevice();
        assertThat(gateway.count("/config")).isEqualTo(13);
        int state = gateway.topics.indexOf("ringlife/migraine_risk/state");
        assertThat(gateway.payloads.get(state)).isEqualTo("None");
    }

    // --- alerts sensor (ADR 0045) ---

    private static final String ALERTS_CONFIG = "homeassistant/sensor/ringlife/alerts/config";

    private void alertsOn(int unseen) {
        when(alerts.homeAssistantSummary("dev")).thenReturn(java.util.Optional.of(
                new AlertService.HaSummary(unseen, "Temperatura della notte sopra il tuo solito", "attenzione", "2026-11-04")));
    }

    @Test
    void theAlertsSensorIsNotPublishedWhileTheDeviceKeepsItOff() {
        publisher.publish("dev");
        assertThat(gateway.topics).noneMatch(t -> t.contains("alerts"));
        assertThat(gateway.count("/config")).isEqualTo(12);
    }

    @Test
    void theAlertsSensorIsPublishedWithItsCountAndTheLatestEventWhenOn() {
        alertsOn(2);
        publisher.publish("dev");
        int config = gateway.topics.indexOf(ALERTS_CONFIG);
        assertThat(config).isPositive();
        var discovery = new tools.jackson.databind.ObjectMapper().readTree(gateway.payloads.get(config));
        assertThat(discovery.get("default_entity_id").asString()).isEqualTo("sensor.ringlife_alerts");
        assertThat(discovery.get("unique_id").asString()).isEqualTo("ringlife_alerts");
        assertThat(discovery.get("json_attributes_topic").asString()).isEqualTo("ringlife/alerts/attributes");
        int state = gateway.topics.indexOf("ringlife/alerts/state");
        assertThat(state).isGreaterThan(config);
        assertThat(gateway.payloads.get(state)).isEqualTo("2");
        var attributes = new tools.jackson.databind.ObjectMapper().readTree(
                gateway.payloads.get(gateway.topics.indexOf("ringlife/alerts/attributes")));
        assertThat(attributes.get("title").asString()).isEqualTo("Temperatura della notte sopra il tuo solito");
        assertThat(attributes.get("level").asString()).isEqualTo("attenzione");
        assertThat(attributes.get("day").asString()).isEqualTo("2026-11-04");
    }

    @Test
    void theAlertsConfigurationIsSentOncePerConnectionAndTheStateEveryTime() {
        alertsOn(1);
        publisher.publish("dev");
        alertsOn(0);
        publisher.publish("dev");
        assertThat(gateway.count(ALERTS_CONFIG)).isEqualTo(1);
        assertThat(gateway.count("ringlife/alerts/state")).isEqualTo(2);
        assertThat(gateway.payloads.get(gateway.topics.lastIndexOf("ringlife/alerts/state"))).isEqualTo("0");
        gateway.connection = 2;
        publisher.publish("dev");
        assertThat(gateway.count(ALERTS_CONFIG)).isEqualTo(2);
    }

    @Test
    void withoutEventsTheAlertsSensorHasZeroAndNoAttributes() {
        when(alerts.homeAssistantSummary("dev")).thenReturn(java.util.Optional.of(new AlertService.HaSummary(0, null, null, null)));
        publisher.publish("dev");
        assertThat(gateway.payloads.get(gateway.topics.indexOf("ringlife/alerts/state"))).isEqualTo("0");
        assertThat(gateway.payloads.get(gateway.topics.indexOf("ringlife/alerts/attributes"))).isEqualTo("{}");
    }

    @Test
    void switchingTheAlertsOffRemovesTheEntityWithEmptyRetainedMessages() {
        alertsOn(1);
        publisher.publish("dev");
        when(alerts.homeAssistantSummary("dev")).thenReturn(java.util.Optional.empty());
        gateway.topics.clear();
        gateway.payloads.clear();
        publisher.removeAlerts();
        assertThat(gateway.topics).containsExactly(ALERTS_CONFIG, "ringlife/alerts/state", "ringlife/alerts/attributes");
        assertThat(gateway.payloads).containsOnly("");
        // Switched on again: the configuration goes out again on the same connection.
        alertsOn(1);
        publisher.publish("dev");
        assertThat(gateway.count(ALERTS_CONFIG)).isEqualTo(2);
    }

    @Test
    void aRemovalTheBrokerMissedIsRetriedAtTheNextPublication() {
        gateway.up = false;
        publisher.removeAlerts();
        assertThat(gateway.topics).isEmpty();
        gateway.up = true;
        publisher.publish("dev");
        assertThat(gateway.count(ALERTS_CONFIG)).isEqualTo(1);
        assertThat(gateway.payloads.get(gateway.topics.indexOf(ALERTS_CONFIG))).isEmpty();
        publisher.publish("dev");
        assertThat(gateway.count(ALERTS_CONFIG)).isEqualTo(1);
    }

    @Test
    void theAlertsRemovalDoesNothingWhenMqttIsOff() {
        publisher = new HaPublisher(settings(""), gateway, results, plugins, alerts);
        publisher.removeAlerts();
        assertThat(gateway.topics).isEmpty();
    }
}
