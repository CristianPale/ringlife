-- Ingest idempotente (ADR 0008). Stesse regole di V1: UUID testo, timestamp UTC in millisecondi.

-- Su iOS l'app non vede il MAC dell'anello: `mac` contiene l'identificativo hardware scelto dall'app.
CREATE UNIQUE INDEX ux_device_mac ON device (mac);

-- Token per dispositivo: si salva solo l'hash, mai il token.
CREATE TABLE api_token (
    id         TEXT   NOT NULL PRIMARY KEY,
    device_id  TEXT   NOT NULL,
    token_hash TEXT   NOT NULL,
    created_at BIGINT NOT NULL,
    revoked_at BIGINT,
    CONSTRAINT fk_token_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ux_token_hash UNIQUE (token_hash)
);

-- Un record per ogni caricamento. `tz_offset_min` e' l'offset dell'ora impostata sull'anello rispetto a UTC
-- al momento del sync: serve a correggere dati importati dopo un cambio di ora o di fuso.
CREATE TABLE sync_log (
    id             TEXT    NOT NULL PRIMARY KEY,
    device_id      TEXT    NOT NULL,
    kind           TEXT    NOT NULL,
    received_at    BIGINT  NOT NULL,
    tz_offset_min  INTEGER NOT NULL,
    received_count INTEGER NOT NULL,
    inserted_count INTEGER NOT NULL,
    CONSTRAINT fk_sync_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_sync_kind CHECK (kind IN ('samples', 'sleep'))
);

CREATE TABLE sleep_session (
    id        TEXT   NOT NULL PRIMARY KEY,
    device_id TEXT   NOT NULL,
    start_ts  BIGINT NOT NULL,
    end_ts    BIGINT NOT NULL,
    CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ux_session_start UNIQUE (device_id, start_ts),
    CONSTRAINT ck_session_range CHECK (end_ts > start_ts)
);

CREATE TABLE sleep_stage (
    session_id TEXT   NOT NULL,
    start_ts   BIGINT NOT NULL,
    end_ts     BIGINT NOT NULL,
    stage      TEXT   NOT NULL,
    PRIMARY KEY (session_id, start_ts),
    CONSTRAINT fk_stage_session FOREIGN KEY (session_id) REFERENCES sleep_session (id) ON DELETE CASCADE,
    CONSTRAINT ck_stage_range CHECK (end_ts > start_ts),
    CONSTRAINT ck_stage_value CHECK (stage IN ('deep', 'light', 'rem', 'awake'))
);
