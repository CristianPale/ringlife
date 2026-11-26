package com.ringlife.backend.ha;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Il client Paho contro un broker in memoria: connessione, messaggi retained, broker spento e riavviato. */
class PahoMqttGatewayTest {

    private EmbeddedBroker broker;
    private PahoMqttGateway gateway;

    @BeforeEach
    void start() throws Exception {
        broker = new EmbeddedBroker();
        broker.start();
        gateway = new PahoMqttGateway(new MqttSettings("127.0.0.1", broker.port(), "", "", "homeassistant"));
    }

    @AfterEach
    void stop() throws Exception {
        gateway.close();
        broker.close();
    }

    @Test
    void publishesAMessageAndConnectsOnDemand() throws Exception {
        assertThat(gateway.connectionId()).isZero();
        assertThat(gateway.publish("ringlife/test/state", "42", true)).isTrue();
        assertThat(gateway.connectionId()).isEqualTo(1);
        assertThat(EmbeddedBroker.waitFor(() -> "42".equals(broker.messages.get("ringlife/test/state")))).isTrue();
    }

    @Test
    void doesNotReconnectWhileConnected() {
        assertThat(gateway.publish("ringlife/a", "1", false)).isTrue();
        assertThat(gateway.publish("ringlife/b", "2", false)).isTrue();
        assertThat(gateway.connectionId()).isEqualTo(1);
    }

    @Test
    void doesNothingWithoutAHost() {
        PahoMqttGateway off = new PahoMqttGateway(new MqttSettings("", 1883, "", "", "homeassistant"));
        assertThat(off.publish("ringlife/a", "1", false)).isFalse();
        assertThat(off.connectionId()).isZero();
    }

    @Test
    void aBrokerThatIsNotThereIsSkippedWithoutThrowing() throws Exception {
        broker.close();
        assertThat(gateway.publish("ringlife/a", "1", false)).isFalse();
        assertThat(gateway.connectionId()).isZero();
    }

    @Test
    void reconnectsAfterTheBrokerComesBackAndSaysSo() throws Exception {
        assertThat(gateway.publish("ringlife/a", "1", true)).isTrue();
        long first = gateway.connectionId();
        int port = broker.port();
        broker.stop();
        assertThat(gateway.publish("ringlife/a", "2", true)).isFalse();

        // Lo stesso broker, di nuovo acceso e senza i vecchi messaggi.
        broker = new EmbeddedBroker(port);
        broker.start();
        assertThat(gateway.publish("ringlife/a", "3", true)).isTrue();
        assertThat(gateway.connectionId()).isGreaterThan(first);
        assertThat(EmbeddedBroker.waitFor(() -> "3".equals(broker.messages.get("ringlife/a")))).isTrue();
    }
}
