-- Stress Rhythm (docs/scores.md): nuovo tipo di indice. SQLite non modifica un CHECK esistente, quindi si ricrea
-- la tabella con la lista ampliata e si copiano le righe.
CREATE TABLE daily_score_new (
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
    CONSTRAINT ck_score_kind CHECK (kind IN ('recovery', 'sleep', 'movement', 'sleep_regularity', 'stress'))
);

INSERT INTO daily_score_new SELECT device_id, day, kind, algo_version, value, components, computed_at FROM daily_score;

DROP TABLE daily_score;

ALTER TABLE daily_score_new RENAME TO daily_score;
