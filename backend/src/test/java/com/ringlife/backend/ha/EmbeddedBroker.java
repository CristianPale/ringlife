package com.ringlife.backend.ha;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import io.moquette.broker.Server;
import io.moquette.broker.config.IConfig;
import io.moquette.broker.config.MemoryConfig;

/** Un broker MQTT in memoria per i test, con un abbonato che registra l'ultimo messaggio di ogni topic. */
final class EmbeddedBroker implements AutoCloseable {

    private final int port;
    private Server server;
    private MqttClient listener;
    final ConcurrentHashMap<String, String> messages = new ConcurrentHashMap<>();

    EmbeddedBroker() {
        this(freePort());
    }

    /** Un broker su una porta scelta: serve a riaccenderlo dove era. */
    EmbeddedBroker(int port) {
        this.port = port;
    }

    int port() {
        return port;
    }

    void start() throws IOException, MqttException {
        Properties properties = new Properties();
        properties.setProperty(IConfig.PORT_PROPERTY_NAME, String.valueOf(port));
        properties.setProperty(IConfig.HOST_PROPERTY_NAME, "127.0.0.1");
        properties.setProperty(IConfig.ALLOW_ANONYMOUS_PROPERTY_NAME, "true");
        properties.setProperty(IConfig.PERSISTENCE_ENABLED_PROPERTY_NAME, "false");
        properties.setProperty(IConfig.ENABLE_TELEMETRY_NAME, "false");
        server = new Server();
        server.startServer(new MemoryConfig(properties));
        listen();
    }

    private void listen() throws MqttException {
        listener = new MqttClient("tcp://127.0.0.1:" + port, "test-listener-" + System.nanoTime(), new MemoryPersistence());
        listener.connect();
        listener.subscribe("#", 1, (topic, message) -> messages.put(topic, new String(message.getPayload(), java.nio.charset.StandardCharsets.UTF_8)));
    }

    /** Ferma il broker: i messaggi retained si perdono, come con un broker svuotato. */
    void stop() throws MqttException {
        if (listener != null && listener.isConnected()) {
            listener.disconnectForcibly(500);
        }
        if (server != null) {
            server.stopServer();
            server = null;
        }
        messages.clear();
    }

    static boolean waitFor(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) {
                return true;
            }
            Thread.sleep(50);
        }
        return condition.getAsBoolean();
    }

    @Override
    public void close() throws MqttException {
        stop();
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
