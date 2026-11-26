package com.ringlife.backend.ha;

/** Pubblicazione MQTT. Dietro un'interfaccia per provare la logica senza un broker (ADR 0011). */
public interface MqttGateway {

    /**
     * Pubblica un messaggio, connettendosi se serve. Restituisce `false` se il broker non e' raggiungibile:
     * non lancia mai, perche' un errore MQTT non deve far fallire un caricamento.
     */
    boolean publish(String topic, String payload, boolean retained);

    /** Cambia a ogni (ri)connessione riuscita: chi ha pubblicato la configurazione sa quando rimandarla. */
    long connectionId();
}
