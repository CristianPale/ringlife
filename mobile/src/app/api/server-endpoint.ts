import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../settings/settings.service';
import { ApiError } from './api-error';

/** Quale indirizzo ha risposto: quello HTTPS (Tailscale) o quello della rete di casa (HTTP, senza cifratura). */
export type Route = 'remote' | 'home';

/** Dopo quanto si lascia perdere l'indirizzo di casa: fuori casa non deve bloccare l'app. */
export const HOME_ATTEMPT_TIMEOUT_MS = 5000;

/**
 * Sceglie a quale indirizzo parlare (docs/adr/0012). Prima l'HTTPS di Tailscale; se non risponde e c'è un
 * indirizzo di casa, quello. L'indirizzo che ha funzionato per ultimo si prova per primo. Cambia indirizzo solo
 * per errori di rete: un token rifiutato o un errore del server non c'entrano con la strada.
 */
@Injectable({ providedIn: 'root' })
export class ServerEndpoint {
  private readonly settings = inject(SettingsService);
  private last: Route | null = null;

  /** Gli indirizzi configurati, nell'ordine in cui provarli. */
  candidates(): { route: Route; base: string }[] {
    const { serverUrl, homeUrl } = this.settings.settings();
    // L'indirizzo HTTPS è obbligatorio: l'indirizzo di casa da solo non basta (docs/adr/0012).
    if (serverUrl === '') {
      return [];
    }
    const all: { route: Route; base: string }[] = [{ route: 'remote', base: serverUrl }];
    if (homeUrl !== '') {
      all.push({ route: 'home', base: homeUrl });
    }
    if (this.last !== null && all.length > 1 && all[1].route === this.last) {
      all.reverse();
    }
    return all;
  }

  /**
   * Esegue `attempt` sul primo indirizzo che risponde. `attempt` riceve l'indirizzo e il tempo massimo da aspettare
   * (solo per quello di casa). Lancia `not-configured` se non c'è nessun indirizzo, altrimenti l'ultimo errore.
   */
  async run<T>(attempt: (base: string, timeoutMs: number | null) => Promise<T>): Promise<{ value: T; route: Route }> {
    const candidates = this.candidates();
    if (candidates.length === 0) {
      throw new ApiError('not-configured');
    }
    let failure: unknown;
    for (const { route, base } of candidates) {
      try {
        const value = await attempt(base, route === 'home' ? HOME_ATTEMPT_TIMEOUT_MS : null);
        this.last = route;
        return { value, route };
      } catch (error) {
        failure = error;
        if (!(error instanceof ApiError) || error.kind !== 'offline') {
          throw error;
        }
      }
    }
    throw failure;
  }
}
