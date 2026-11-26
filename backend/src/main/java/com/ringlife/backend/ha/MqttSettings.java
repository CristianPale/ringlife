package com.ringlife.backend.ha;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Collegamento al broker MQTT (ADR 0011). Host vuoto = MQTT spento. */
@Component
public class MqttSettings {

    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String discoveryPrefix;

    @Autowired
    MqttSettings(
            @Value("${ringlife.mqtt.host:}") String host,
            @Value("${ringlife.mqtt.port:1883}") int port,
            @Value("${ringlife.mqtt.username:}") String username,
            @Value("${ringlife.mqtt.password:}") String password,
            @Value("${ringlife.mqtt.discovery-prefix:homeassistant}") String discoveryPrefix) {
        this.host = host == null ? "" : host.trim();
        this.port = port;
        this.username = username == null ? "" : username;
        this.password = password == null ? "" : password;
        this.discoveryPrefix = discoveryPrefix == null || discoveryPrefix.isBlank() ? "homeassistant" : discoveryPrefix.trim();
    }

    public boolean enabled() {
        return !host.isEmpty();
    }

    public String serverUri() {
        return "tcp://" + host + ":" + port;
    }

    public String username() {
        return username;
    }

    public String password() {
        return password;
    }

    public String discoveryPrefix() {
        return discoveryPrefix;
    }
}
