package com.ringlife.backend.ha;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

/**
 * Client Paho (ADR 0011). Si connette alla prima pubblicazione e si riconnette da solo; se il broker non risponde
 * si salta e si riprova alla prossima. Il last will segna le entita' come non disponibili se il backend sparisce.
 */
@Component
class PahoMqttGateway implements MqttGateway {

    private static final Logger LOG = LoggerFactory.getLogger(PahoMqttGateway.class);
    private static final int TIMEOUT_SECONDS = 5;

    private final MqttSettings settings;
    private final AtomicLong connection = new AtomicLong();
    private MqttClient client;

    PahoMqttGateway(MqttSettings settings) {
        this.settings = settings;
    }

    @Override
    public long connectionId() {
        return connection.get();
    }

    @Override
    public synchronized boolean publish(String topic, String payload, boolean retained) {
        if (!settings.enabled()) {
            return false;
        }
        try {
            if (!ensureConnected()) {
                return false;
            }
            client.publish(topic, payload.getBytes(StandardCharsets.UTF_8), 1, retained);
            return true;
        } catch (MqttException e) {
            // Solo il tipo e il codice: il messaggio potrebbe contenere valori.
            LOG.warn("Pubblicazione MQTT fallita (codice {})", e.getReasonCode());
            return false;
        }
    }

    private boolean ensureConnected() throws MqttException {
        if (client != null && client.isConnected()) {
            return true;
        }
        if (client == null) {
            client = new MqttClient(settings.serverUri(), "ringlife-" + UUID.randomUUID(), new MemoryPersistence());
        }
        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setConnectionTimeout(TIMEOUT_SECONDS);
        options.setKeepAliveInterval(30);
        // Riconnessione a mano alla prossima pubblicazione: cosi' `connectionId` cambia e la configurazione si rimanda.
        options.setAutomaticReconnect(false);
        if (!settings.username().isEmpty()) {
            options.setUserName(settings.username());
            options.setPassword(settings.password().toCharArray());
        }
        options.setWill(HaEntities.AVAILABILITY_TOPIC, HaEntities.OFFLINE.getBytes(StandardCharsets.UTF_8), 1, true);
        try {
            client.connect(options);
        } catch (MqttException e) {
            LOG.warn("Connessione MQTT non riuscita (codice {})", e.getReasonCode());
            return false;
        }
        connection.incrementAndGet();
        return true;
    }

    @PreDestroy
    synchronized void close() {
        if (client == null) {
            return;
        }
        try {
            if (client.isConnected()) {
                client.publish(HaEntities.AVAILABILITY_TOPIC, HaEntities.OFFLINE.getBytes(StandardCharsets.UTF_8), 1, true);
                client.disconnect(2000);
            }
            client.close();
        } catch (MqttException e) {
            LOG.debug("Chiusura MQTT: codice {}", e.getReasonCode());
        }
    }
}
