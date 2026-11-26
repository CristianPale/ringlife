-- Metriche giornaliere, baseline e punteggi (ADR 0009). `day` e' il giorno locale, YYYY-MM-DD.

CREATE TABLE daily_feature (
    device_id TEXT NOT NULL,
    day       TEXT NOT NULL,
    feature   TEXT NOT NULL,
    value     DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (device_id, day, feature),
    CONSTRAINT fk_feature_device FOREIGN KEY (device_id) REFERENCES device (id)
);

CREATE TABLE baseline (
    device_id   TEXT    NOT NULL,
    day         TEXT    NOT NULL,
    feature     TEXT    NOT NULL,
    window_days INTEGER NOT NULL,
    median      DOUBLE PRECISION NOT NULL,
    mad         DOUBLE PRECISION NOT NULL,
    count       INTEGER NOT NULL,
    PRIMARY KEY (device_id, day, feature),
    CONSTRAINT fk_baseline_device FOREIGN KEY (device_id) REFERENCES device (id)
);

-- Solo indici 0-100. Chiave con algo_version: una formula nuova aggiunge righe, non cancella le vecchie.
CREATE TABLE daily_score (
    device_id    TEXT    NOT NULL,
    day          TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    algo_version TEXT    NOT NULL,
    value        INTEGER NOT NULL,
    components   TEXT    NOT NULL,
    computed_at  BIGINT  NOT NULL,
    PRIMARY KEY (device_id, day, kind, algo_version),
    CONSTRAINT fk_score_device FOREIGN KEY (device_id) REFERENCES device (id),
    CONSTRAINT ck_score_range CHECK (value BETWEEN 0 AND 100),
    CONSTRAINT ck_score_kind CHECK (kind IN ('recovery', 'sleep', 'movement', 'sleep_regularity'))
);

-- Uscite con unita' e senza intervallo fisso (ore di debito, livello, mediana SpO2, gradi).
CREATE TABLE daily_metric (
    device_id    TEXT   NOT NULL,
    day          TEXT   NOT NULL,
    metric       TEXT   NOT NULL,
    algo_version TEXT   NOT NULL,
    value        DOUBLE PRECISION,
    unit         TEXT,
    detail       TEXT,
    computed_at  BIGINT NOT NULL,
    PRIMARY KEY (device_id, day, metric, algo_version),
    CONSTRAINT fk_metric_device FOREIGN KEY (device_id) REFERENCES device (id)
);
