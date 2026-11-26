// Push dal server di casa con il testo cifrato (docs/adr/0047): il contratto del server.

/** Quello che il telefono manda al server per ricevere le push. */
export interface PushRegistration {
  /** Il token APNs del telefono, in esadecimale. */
  token: string;
  /** La chiave AES-256 con cui il server cifra il testo, in base64 (32 byte). */
  key: string;
  environment: 'production' | 'sandbox';
}

/** Lo stato delle push per questo telefono, secondo il server. */
export interface PushStatus {
  registered: boolean;
  /** Il server ha la chiave APNs: senza, le push sono spente e gli avvisi arrivano come nella fase 1. */
  serverReady: boolean;
  environment: 'production' | 'sandbox' | null;
  lastSentAt: number | null;
  lastError: string | null;
}
