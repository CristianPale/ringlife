-- Avvisi, fase 1 (ADR 0045). Configurazione per dispositivo e regola, eventi unici per dispositivo, regola e giorno.
-- Senza riga in alert_settings o alert_rule valgono i predefiniti del codice. JSON come testo (schema portabile, ADR 0004).
-- ON DELETE CASCADE: configurazione ed eventi non sopravvivono al loro dispositivo.

CREATE TABLE alert_settings (
    device_id      TEXT    NOT NULL PRIMARY KEY,
    quiet_start    TEXT    NOT NULL,
    quiet_end      TEXT    NOT NULL,
    lock_screen    TEXT    NOT NULL,
    home_assistant INTEGER NOT NULL DEFAULT 0,
    updated_at     BIGINT  NOT NULL,
    CONSTRAINT fk_alert_settings_device FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE,
    CONSTRAINT ck_alert_settings_lock CHECK (lock_screen IN ('breve', 'generico')),
    CONSTRAINT ck_alert_settings_ha CHECK (home_assistant IN (0, 1))
);

-- `config` tiene solo i valori scelti (sensitivity, days, threshold, delivery): il resto sono i predefiniti della regola.
CREATE TABLE alert_rule (
    device_id  TEXT    NOT NULL,
    rule_id    TEXT    NOT NULL,
    enabled    INTEGER NOT NULL,
    config     TEXT    NOT NULL DEFAULT '{}',
    updated_at BIGINT  NOT NULL,
    PRIMARY KEY (device_id, rule_id),
    CONSTRAINT fk_alert_rule_device FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE,
    CONSTRAINT ck_alert_rule_enabled CHECK (enabled IN (0, 1))
);

-- Un evento e' scritto una volta e non si aggiorna: solo `seen_at` cambia. Istanti in millisecondi UTC.
CREATE TABLE alert_event (
    id            TEXT   NOT NULL PRIMARY KEY,
    device_id     TEXT   NOT NULL,
    rule_id       TEXT   NOT NULL,
    day           TEXT   NOT NULL,
    level         TEXT   NOT NULL,
    title         TEXT   NOT NULL,
    body          TEXT   NOT NULL,
    route         TEXT   NOT NULL,
    values_json   TEXT   NOT NULL DEFAULT '{}',
    created_at    BIGINT NOT NULL,
    deliver_after BIGINT,
    seen_at       BIGINT,
    CONSTRAINT fk_alert_event_device FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE,
    CONSTRAINT uq_alert_event_day UNIQUE (device_id, rule_id, day),
    CONSTRAINT ck_alert_event_level CHECK (level IN ('attenzione', 'alto'))
);
CREATE INDEX ix_alert_event_device_created ON alert_event (device_id, created_at);
