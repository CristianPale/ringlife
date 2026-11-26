-- Letture orarie della pressione atmosferica da Home Assistant (ADR 0017). Non e' per dispositivo: e' il meteo di casa.
CREATE TABLE weather_sample (
    ts           BIGINT PRIMARY KEY,
    pressure_hpa REAL   NOT NULL,
    CONSTRAINT ck_weather_pressure CHECK (pressure_hpa BETWEEN 800 AND 1100)
);
