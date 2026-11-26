-- Letture orarie dell'indice UV da Home Assistant (ADR 0031), per il plugin Vitamina D. Il meteo di casa, non per
-- dispositivo: tabella a se' perche' la pressione puo' mancare quando l'UV c'e', e viceversa.
CREATE TABLE uv_sample (
    ts       BIGINT PRIMARY KEY,
    uv_index REAL   NOT NULL,
    CONSTRAINT ck_uv_index CHECK (uv_index BETWEEN 0 AND 20)
);
