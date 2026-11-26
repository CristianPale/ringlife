-- Schema portabile tra SQLite e PostgreSQL (ADR 0004):
-- UUID come testo generato dall'applicazione, timestamp UTC come epoch in millisecondi.

CREATE TABLE device (
    id           TEXT    NOT NULL PRIMARY KEY,
    mac          TEXT    NOT NULL,
    model        TEXT    NOT NULL,
    firmware     TEXT,
    last_sync_at BIGINT
);

CREATE TABLE sample (
    device_id TEXT    NOT NULL,
    metric    TEXT    NOT NULL,
    ts        BIGINT  NOT NULL,
    value     DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (device_id, metric, ts),
    CONSTRAINT fk_sample_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_sample_metric CHECK (metric IN ('HR', 'SPO2', 'STRESS', 'HRV', 'TEMP', 'STEPS', 'CALORIES'))
);
