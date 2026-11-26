import { HttpErrorResponse } from '@angular/common/http';

/**
 * Perché una chiamata al backend non è andata a buon fine. Serve alla UI per dire cosa fare, non per mostrare
 * il testo del server: i messaggi del backend sono in italiano ma tecnici.
 */
export type ApiErrorKind =
  | 'not-configured'
  | 'not-paired'
  | 'offline'
  | 'unauthorized'
  | 'rejected'
  | 'disabled'
  | 'server';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = 'ApiError';
  }
}

/** Traduce un errore HTTP. `registration` = la chiamata è la registrazione: lì un 404 vuol dire «disattivata». */
export function toApiError(error: unknown, registration = false): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 0:
        return new ApiError('offline');
      case 400:
        return new ApiError('rejected', 400);
      case 401:
        return new ApiError('unauthorized', 401);
      case 404:
        return new ApiError(registration ? 'disabled' : 'server', 404);
      default:
        return new ApiError('server', error.status);
    }
  }
  return new ApiError('server');
}

const MESSAGES: Record<ApiErrorKind, string> = {
  'not-configured': "Inserisci prima l'indirizzo del server.",
  'not-paired': 'Collega questo telefono al server.',
  offline: "Il server non risponde. Controlla l'indirizzo e che il telefono sia sulla rete di casa o su Tailscale.",
  unauthorized: 'Accesso rifiutato. Controlla il segreto di registrazione, o collega di nuovo il telefono.',
  rejected: 'Il server ha rifiutato la richiesta.',
  disabled: 'Sul server la registrazione dei telefoni è disattivata: imposta il segreto nelle opzioni dell\'app.',
  server: 'Il server ha avuto un problema. Riprova tra poco.',
};

export function describeApiError(kind: ApiErrorKind): string {
  return MESSAGES[kind];
}
