-- Framework dei plugin (ADR 0013). Un plugin senza riga in plugin_state e' acceso e usa i predefiniti.
CREATE TABLE plugin_state (
    device_id  TEXT    NOT NULL,
    plugin_id  TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    config     TEXT    NOT NULL DEFAULT '{}',
    updated_at BIGINT  NOT NULL,
    PRIMARY KEY (device_id, plugin_id),
    CONSTRAINT fk_plugin_state_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_plugin_state_enabled CHECK (enabled IN (0, 1))
);

-- Un risultato per dispositivo, plugin, giorno e versione del plugin: una versione nuova non cancella la vecchia.
CREATE TABLE plugin_result (
    device_id   TEXT   NOT NULL,
    plugin_id   TEXT   NOT NULL,
    day         TEXT   NOT NULL,
    version     TEXT   NOT NULL,
    payload     TEXT   NOT NULL,
    computed_at BIGINT NOT NULL,
    PRIMARY KEY (device_id, plugin_id, day, version),
    CONSTRAINT fk_plugin_result_device FOREIGN KEY (device_id) REFERENCES device (id)
);
