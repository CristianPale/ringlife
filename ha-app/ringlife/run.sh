#!/usr/bin/with-contenv bashio
# Avvio del backend: legge le opzioni dell'app e le passa al processo come variabili d'ambiente.
# Il segreto di registrazione non finisce mai nei log.
set -euo pipefail

# Opzione assente o non impostata: bashio restituisce la stringa "null" o vuota.
option() {
    local value
    value="$(bashio::config "$1")"
    if [ "$value" = "null" ]; then
        value=""
    fi
    printf '%s' "$value"
}

# Dati persistenti in /data: rientrano nei backup di HA.
export RINGLIFE_DB_PATH=/data/ringlife.sqlite
export PORT=8080
export RINGLIFE_PAIRING_SECRET="$(option pairing_secret)"
export RINGLIFE_GOALS_SLEEP_MINUTES="$(option sleep_goal_minutes)"
export RINGLIFE_GOALS_STEPS="$(option steps_goal)"
export RINGLIFE_ZONE="$(option timezone)"
# Entita' meteo di HA da cui leggere la pressione (docs/adr/0017). Vuota = nessuna lettura.
export RINGLIFE_WEATHER_ENTITY="$(option weather_entity)"
# Sensore dell'indice UV per il plugin Vitamina D (docs/adr/0031). Vuoto = attributo uv_index dell'entita' meteo.
export RINGLIFE_WEATHER_UV_ENTITY="$(option uv_entity)"
# Push cifrate verso l'iPhone (docs/adr/0047): contenuto del file .p8, il suo id e il team Apple. Vuote = push spente.
# La chiave e' un segreto: non finisce mai nei log.
export RINGLIFE_APNS_KEY="$(option apns_key)"
export RINGLIFE_APNS_KEY_ID="$(option apns_key_id)"
export RINGLIFE_APNS_TEAM_ID="$(option apns_team_id)"
# Bundle ID dell'app che riceve le push. Vuoto = com.ringlife.app (lo decide il backend).
export RINGLIFE_APNS_TOPIC="$(option apns_topic)"

# Broker MQTT del Supervisor (`mqtt:need`): host, porta e credenziali per le entita' di Home Assistant.
# Senza il servizio il backend parte lo stesso, con MQTT spento. Le credenziali non finiscono mai nei log.
if bashio::services.available "mqtt"; then
    export MQTT_HOST="$(bashio::services mqtt "host")"
    export MQTT_PORT="$(bashio::services mqtt "port")"
    export MQTT_USERNAME="$(bashio::services mqtt "username")"
    export MQTT_PASSWORD="$(bashio::services mqtt "password")"
    bashio::log.info "MQTT collegato: le entita' di RingLife compaiono in Home Assistant."
else
    bashio::log.warning "Servizio MQTT non disponibile: le entita' in Home Assistant sono spente."
fi

if [ -z "$RINGLIFE_PAIRING_SECRET" ]; then
    bashio::log.warning "pairing_secret non impostato: la registrazione dei telefoni e' disattivata."
else
    bashio::log.info "Registrazione dei telefoni attiva."
fi
if [ -n "$RINGLIFE_APNS_KEY" ] && [ -n "$RINGLIFE_APNS_KEY_ID" ] && [ -n "$RINGLIFE_APNS_TEAM_ID" ]; then
    bashio::log.info "Push cifrate attive."
else
    bashio::log.info "Push cifrate spente: gli avvisi arrivano quando l'app si apre."
fi
bashio::log.info "Avvio del backend RingLife."

# Il server e' condiviso con la domotica: l'heap e' limitato e un esaurimento di memoria fa uscire il processo,
# cosi' il watchdog lo riavvia invece di lasciarlo degradare.
exec "${RINGLIFE_JAVA:-java}" \
    -Xmx512m \
    -XX:+UseSerialGC \
    -XX:+ExitOnOutOfMemoryError \
    -jar /opt/ringlife/ringlife-backend.jar
