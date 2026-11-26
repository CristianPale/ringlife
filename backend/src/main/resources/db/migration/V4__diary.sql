-- Sync del diario (ADR 0010). La chiave e' (dispositivo, id): l'id e' lo UUID generato sul telefono.
-- Il diario si modifica, quindi si scrive con upsert; `updated_at` e' l'istante dell'ultimo invio.

CREATE TABLE journal_entry (
    device_id  TEXT   NOT NULL,
    id         TEXT   NOT NULL,
    ts         BIGINT NOT NULL,
    kind       TEXT   NOT NULL,
    payload    TEXT   NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (device_id, id),
    CONSTRAINT fk_journal_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_journal_kind CHECK (kind IN ('caffeine', 'alcohol', 'note'))
);
CREATE INDEX ix_journal_device_ts ON journal_entry (device_id, ts);

CREATE TABLE headache_episode (
    device_id  TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    start_ts   BIGINT  NOT NULL,
    end_ts     BIGINT,
    intensity  INTEGER NOT NULL,
    payload    TEXT    NOT NULL,
    updated_at BIGINT  NOT NULL,
    PRIMARY KEY (device_id, id),
    CONSTRAINT fk_headache_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_headache_intensity CHECK (intensity BETWEEN 1 AND 10),
    CONSTRAINT ck_headache_range CHECK (end_ts IS NULL OR end_ts >= start_ts)
);
CREATE INDEX ix_headache_device_start ON headache_episode (device_id, start_ts);
