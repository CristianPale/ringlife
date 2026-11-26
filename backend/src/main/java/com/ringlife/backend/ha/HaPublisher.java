package com.ringlife.backend.ha;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.compute.LatestResults;
import com.ringlife.backend.ha.HaEntities.Message;
import com.ringlife.backend.plugin.PluginService;

/**
 * Pubblica le entita' in Home Assistant (ADR 0011). Dopo ogni (ri)connessione manda prima la disponibilita' e le
 * configurazioni, poi gli stati. Non lancia mai: un errore MQTT non deve toccare il calcolo ne' i caricamenti.
 */
@Service
public class HaPublisher {

    private static final Logger LOG = LoggerFactory.getLogger(HaPublisher.class);

    private final MqttSettings settings;
    private final MqttGateway gateway;
    private final LatestResults latest;
    private final PluginService plugins;
    private final AlertService alerts;

    private long announcedOn = -1;
    /** Connection on which the alerts sensor's configuration was sent; -1 = not sent on this one. */
    private long alertsAnnouncedOn = -1;
    /** The alerts sensor was switched off but the broker did not take the removal yet. */
    private boolean alertsRemovalPending;

    HaPublisher(MqttSettings settings, MqttGateway gateway, LatestResults latest, PluginService plugins, AlertService alerts) {
        this.settings = settings;
        this.gateway = gateway;
        this.latest = latest;
        this.plugins = plugins;
        this.alerts = alerts;
    }

    /** All'avvio: gli stati salvati tornano in HA anche dopo un riavvio del backend. */
    @EventListener(ApplicationReadyEvent.class)
    void onStart() {
        publishLatestDevice();
    }

    /** Pubblica i risultati del dispositivo che ha caricato dati piu' di recente. */
    public void publishLatestDevice() {
        if (!settings.enabled()) {
            return;
        }
        try {
            String device = latest.latestSyncedDevice();
            if (device != null) {
                publish(device);
            } else {
                publishUnknown();
            }
        } catch (RuntimeException e) {
            LOG.warn("Pubblicazione delle entita' fallita: {}", e.getClass().getSimpleName());
        }
    }

    /** Pubblica i risultati di un dispositivo. */
    public synchronized void publish(String deviceId) {
        if (!settings.enabled()) {
            return;
        }
        try {
            if (!announce()) {
                return;
            }
            for (Message message : HaEntities.states(latest.of(deviceId))) {
                if (!gateway.publish(message.topic(), message.payload(), message.retained())) {
                    return;
                }
            }
            for (Message message : HaEntities.pluginStates(plugins.entityDefinitions(), plugins.entityStates(deviceId))) {
                if (!gateway.publish(message.topic(), message.payload(), message.retained())) {
                    return;
                }
            }
            publishAlerts(deviceId);
        } catch (RuntimeException e) {
            LOG.warn("Pubblicazione delle entita' fallita: {}", e.getClass().getSimpleName());
        }
    }

    /**
     * Removes the alerts sensor (ADR 0045): the device switched `homeAssistant` off. If the broker is down, the removal
     * is retried at the next publication. Never throws.
     */
    public synchronized void removeAlerts() {
        if (!settings.enabled()) {
            return;
        }
        alertsAnnouncedOn = -1;
        try {
            alertsRemovalPending = !send(HaEntities.alertsRemoval(settings.discoveryPrefix()));
        } catch (RuntimeException e) {
            alertsRemovalPending = true;
            LOG.warn("Rimozione dell'entita' degli avvisi fallita: {}", e.getClass().getSimpleName());
        }
    }

    /** The alerts sensor, only while the device publishes its alerts in HA: configuration once per connection, then the state. */
    private void publishAlerts(String deviceId) {
        var summary = alerts.homeAssistantSummary(deviceId);
        if (summary.isEmpty()) {
            if (alertsRemovalPending && send(HaEntities.alertsRemoval(settings.discoveryPrefix()))) {
                alertsRemovalPending = false;
            }
            return;
        }
        alertsRemovalPending = false;
        long connection = gateway.connectionId();
        if (alertsAnnouncedOn != connection) {
            if (!send(List.of(HaEntities.alertsConfig(settings.discoveryPrefix())))) {
                return;
            }
            alertsAnnouncedOn = connection;
        }
        send(HaEntities.alertsStates(summary.get()));
    }

    /** Publishes the messages in order; `false` at the first one the broker does not take. */
    private boolean send(List<Message> messages) {
        for (Message message : messages) {
            if (!gateway.publish(message.topic(), message.payload(), message.retained())) {
                return false;
            }
        }
        return true;
    }

    /**
     * Nessun dispositivo ha ancora caricato dati: le entita' esistono comunque in HA, con stato «sconosciuto»,
     * cosi' le automazioni di casa si possono costruire prima del primo sync.
     */
    private synchronized void publishUnknown() {
        if (!announce()) {
            return;
        }
        for (Message message : HaEntities.states(HaEntities.noData())) {
            if (!gateway.publish(message.topic(), message.payload(), message.retained())) {
                return;
            }
        }
        for (Message message : HaEntities.pluginStates(plugins.entityDefinitions(), java.util.Map.of())) {
            if (!gateway.publish(message.topic(), message.payload(), message.retained())) {
                return;
            }
        }
    }

    /** Disponibilita' e configurazioni, una volta per connessione. `false` se il broker non risponde. */
    private boolean announce() {
        // La prima pubblicazione apre la connessione: l'identificativo si legge dopo.
        if (!gateway.publish(HaEntities.AVAILABILITY_TOPIC, HaEntities.ONLINE, true)) {
            return false;
        }
        long connection = gateway.connectionId();
        if (connection == announcedOn) {
            return true;
        }
        List<Message> configs = new java.util.ArrayList<>(HaEntities.configs(settings.discoveryPrefix()));
        configs.addAll(HaEntities.pluginConfigs(settings.discoveryPrefix(), plugins.entityDefinitions()));
        for (Message config : configs) {
            if (!gateway.publish(config.topic(), config.payload(), config.retained())) {
                return false;
            }
        }
        announcedOn = connection;
        return true;
    }
}
