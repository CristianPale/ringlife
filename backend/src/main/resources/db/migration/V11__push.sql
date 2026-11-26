-- Push cifrate (ADR 0047). Una registrazione per dispositivo: token APNs (esadecimale), chiave AES da 256 bit in base64
-- e ambiente di Apple. Token e chiave non finiscono mai nei log. Istanti in millisecondi UTC.
CREATE TABLE push_registration (
    device_id    TEXT   NOT NULL PRIMARY KEY,
    token        TEXT   NOT NULL,
    key          TEXT   NOT NULL,
    environment  TEXT   NOT NULL,
    created_at   BIGINT NOT NULL,
    updated_at   BIGINT NOT NULL,
    last_sent_at BIGINT,
    last_error   TEXT,
    CONSTRAINT fk_push_registration_device FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE,
    CONSTRAINT ck_push_registration_environment CHECK (environment IN ('production', 'sandbox'))
);

-- Stato push di ogni evento: `none` (push non attive o consegna `elenco`), `pending` (da mandare a `push_due_at`),
-- `sent` (a `pushed_at`), `failed`. `push_attempts` conta gli invii falliti per errori di rete o di Apple (5xx, 429).
-- Gli eventi gia' scritti partono da `none`: il telefono li ha gia' notificati in locale.
ALTER TABLE alert_event ADD COLUMN push_state TEXT NOT NULL DEFAULT 'none'
    CONSTRAINT ck_alert_event_push_state CHECK (push_state IN ('none', 'pending', 'sent', 'failed'));
ALTER TABLE alert_event ADD COLUMN push_due_at BIGINT;
ALTER TABLE alert_event ADD COLUMN pushed_at BIGINT;
ALTER TABLE alert_event ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX ix_alert_event_push_due ON alert_event (push_state, push_due_at);
