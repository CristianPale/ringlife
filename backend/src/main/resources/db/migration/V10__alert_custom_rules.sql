-- Avvisi tuoi (ADR 0046): regole costruite dall'utente, al massimo 20 per dispositivo (limite nel codice).
-- Una regola: misura x confronto x quantita' x giorni di fila x livello x consegna, accesa o spenta. Il nome lo scrive il
-- server dalla regola, quindi non si salva. `amount` e' in scostamenti per i confronti con la tua media, nell'unita' della
-- misura per gli altri. Le misure ammesse sono nel codice: una misura tolta dal catalogo lascia la regola ferma.
-- ON DELETE CASCADE come in V9: le regole non sopravvivono al loro dispositivo. Gli eventi gia' creati restano anche
-- quando la regola si cancella (alert_event non ha una chiave esterna verso questa tabella).

CREATE TABLE alert_custom_rule (
    device_id  TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    metric     TEXT    NOT NULL,
    comparison TEXT    NOT NULL,
    amount     REAL    NOT NULL,
    days       INTEGER NOT NULL,
    level      TEXT    NOT NULL,
    delivery   TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT  NOT NULL,
    updated_at BIGINT  NOT NULL,
    PRIMARY KEY (device_id, id),
    CONSTRAINT fk_alert_custom_rule_device FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE,
    CONSTRAINT ck_alert_custom_rule_comparison CHECK (comparison IN ('above_average', 'below_average', 'above', 'below')),
    CONSTRAINT ck_alert_custom_rule_days CHECK (days BETWEEN 1 AND 7),
    CONSTRAINT ck_alert_custom_rule_level CHECK (level IN ('attenzione', 'alto')),
    CONSTRAINT ck_alert_custom_rule_delivery CHECK (delivery IN ('notifica', 'importante', 'elenco')),
    CONSTRAINT ck_alert_custom_rule_enabled CHECK (enabled IN (0, 1))
);
