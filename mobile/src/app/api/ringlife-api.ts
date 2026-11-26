import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, TimeoutError, firstValueFrom, timeout } from 'rxjs';
import {
  DayView,
  DiaryPayload,
  DiaryView,
  MAX_SAMPLES_PER_REQUEST,
  MAX_SESSIONS_PER_REQUEST,
  MigraineReportData,
  SamplePayload,
  SleepSessionPayload,
  UploadResult,
  chunk,
} from './api.model';
import { ApiError, toApiError } from './api-error';
import { BinaryHttp } from './binary-http';
import { PluginView } from '../plugins/plugin.model';
import { CredentialsService } from './credentials.service';
import { Route, ServerEndpoint } from './server-endpoint';
import { AlertEvent, AlertsConfig, AlertsConfigPatch, CustomRuleDraft } from '../avvisi/alerts.model';
import { PushRegistration, PushStatus } from '../avvisi/push.model';

interface RegisterResponse {
  deviceId: string;
  token: string;
}

/**
 * Client del backend (docs/api.md). Un caricamento è idempotente: se la rete cade a metà si può ripetere
 * la stessa chiamata, il server non duplica niente. Ogni errore diventa un `ApiError` con il suo tipo.
 */
@Injectable({ providedIn: 'root' })
export class RingLifeApi {
  private readonly http = inject(HttpClient);
  private readonly endpoint = inject(ServerEndpoint);
  private readonly credentials = inject(CredentialsService);
  private readonly binary = inject(BinaryHttp);

  /** Il server risponde e sta bene? Mai un errore: «non raggiungibile» è un risultato, non un'eccezione. */
  async health(): Promise<boolean> {
    return (await this.healthRoute()) !== null;
  }

  /** Come `health()`, ma dice anche quale indirizzo ha risposto, o `null` se nessuno. */
  async healthRoute(): Promise<Route | null> {
    try {
      const { value, route } = await this.send((base) => this.http.get<{ status?: string }>(`${base}/actuator/health`));
      return value?.status === 'UP' ? route : null;
    } catch {
      return null;
    }
  }

  /** Registra questo telefono con il segreto delle opzioni dell'app e salva l'accesso. Il segreto non si conserva. */
  async register(pairingSecret: string, model = 'R09'): Promise<void> {
    try {
      const { value } = await this.send(
        (base) =>
          this.http.post<RegisterResponse>(
            `${base}/api/v1/devices`,
            { hardwareId: this.credentials.hardwareId(), model },
            { headers: new HttpHeaders({ 'X-Pairing-Secret': pairingSecret }) },
          ),
        true,
      );
      await this.credentials.savePaired({ deviceId: value.deviceId, token: value.token });
    } catch (error) {
      throw toApiError(error, true);
    }
  }

  /** Carica campioni, a gruppi da 5.000. Restituisce il totale su tutti i gruppi. */
  async uploadSamples(samples: readonly SamplePayload[], tzOffset: number): Promise<UploadResult> {
    return this.uploadInGroups('samples', 'samples', samples, MAX_SAMPLES_PER_REQUEST, tzOffset);
  }

  /** Carica sessioni di sonno, a gruppi da 31. */
  async uploadSleep(sessions: readonly SleepSessionPayload[], tzOffset: number): Promise<UploadResult> {
    return this.uploadInGroups('sleep', 'sessions', sessions, MAX_SESSIONS_PER_REQUEST, tzOffset);
  }

  /** Invia il diario: voci ed episodi nuovi o cambiati, e gli id tolti. Ripetere la richiesta è sicuro. */
  async syncDiary(payload: DiaryPayload): Promise<void> {
    await this.authorised((device, headers, base) =>
      this.http.put<unknown>(`${base}/api/v1/devices/${device}/diary`, payload, { headers }),
    );
  }

  /** Il diario salvato sul server, per ripristinarlo su un telefono nuovo. */
  async getDiary(): Promise<DiaryView> {
    return this.authorised((device, headers, base) =>
      this.http.get<DiaryView>(`${base}/api/v1/devices/${device}/diary`, { headers }),
    );
  }

  /** Risultati di un giorno locale, `AAAA-MM-GG`. */
  async getDay(day: string): Promise<DayView> {
    return this.authorised((device, headers, base) =>
      this.http.get<DayView>(`${base}/api/v1/devices/${device}/days/${day}`, { headers }),
    );
  }

  /** Risultati di un intervallo, al massimo 120 giorni. */
  async getDays(from: string, to: string): Promise<DayView[]> {
    return this.authorised((device, headers, base) =>
      this.http.get<DayView[]>(`${base}/api/v1/devices/${device}/days`, {
        headers,
        params: { from, to },
      }),
    );
  }

  /** I plugin del server con il risultato di oggi (docs/adr/0013). */
  async getPlugins(): Promise<PluginView[]> {
    return this.authorised((device, headers, base) =>
      this.http.get<PluginView[]>(`${base}/api/v1/devices/${device}/plugins`, { headers }),
    );
  }

  /** Accende o spegne un plugin sul server. Lo rivaluta subito se acceso. */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginView> {
    return this.authorised((device, headers, base) =>
      this.http.put<PluginView>(`${base}/api/v1/devices/${device}/plugins/${pluginId}`, { enabled }, { headers }),
    );
  }

  /** Imposta i parametri di un plugin (solo quelli diversi dai predefiniti; `{}` li ripristina). Lo rivaluta subito. */
  async setPluginConfig(pluginId: string, config: Record<string, unknown>): Promise<PluginView> {
    return this.authorised((device, headers, base) =>
      this.http.put<PluginView>(`${base}/api/v1/devices/${device}/plugins/${pluginId}`, { config }, { headers }),
    );
  }

  /** La configurazione degli avvisi: impostazioni generali e regole (docs/adr/0045). */
  async getAlertsConfig(): Promise<AlertsConfig> {
    return this.authorised((device, headers, base) => this.http.get<AlertsConfig>(`${base}/api/v1/devices/${device}/alerts/config`, { headers }));
  }

  /** Cambia solo i campi presenti; risponde con la configurazione intera. */
  async setAlertsConfig(patch: AlertsConfigPatch): Promise<AlertsConfig> {
    return this.authorised((device, headers, base) =>
      this.http.put<AlertsConfig>(`${base}/api/v1/devices/${device}/alerts/config`, patch, { headers }),
    );
  }

  /** Gli avvisi dal più recente; senza `since`, gli ultimi 30 giorni. */
  async getAlerts(since: number | null = null): Promise<{ events: AlertEvent[]; unseen: number }> {
    return this.authorised((device, headers, base) =>
      this.http.get<{ events: AlertEvent[]; unseen: number }>(`${base}/api/v1/devices/${device}/alerts`, {
        headers,
        params: since === null ? {} : { since: String(since) },
      }),
    );
  }

  /** Segna come visti gli avvisi indicati, o tutti. */
  async markAlertsSeen(ids: readonly string[] | 'all'): Promise<void> {
    await this.authorised((device, headers, base) =>
      this.http.post<unknown>(`${base}/api/v1/devices/${device}/alerts/seen`, ids === 'all' ? { all: true } : { ids }, { headers }),
    );
  }

  /** Crea un avviso tuo (docs/adr/0046); risponde con la configurazione intera. */
  async createCustomAlert(draft: CustomRuleDraft): Promise<AlertsConfig> {
    return this.authorised((device, headers, base) =>
      this.http.post<AlertsConfig>(`${base}/api/v1/devices/${device}/alerts/custom`, draft, { headers }),
    );
  }

  /** Cambia i campi presenti di un avviso tuo. */
  async updateCustomAlert(id: string, patch: Partial<CustomRuleDraft>): Promise<AlertsConfig> {
    return this.authorised((device, headers, base) =>
      this.http.put<AlertsConfig>(`${base}/api/v1/devices/${device}/alerts/custom/${encodeURIComponent(id)}`, patch, { headers }),
    );
  }

  /** Toglie un avviso tuo; gli eventi già creati restano. */
  async deleteCustomAlert(id: string): Promise<AlertsConfig> {
    return this.authorised((device, headers, base) =>
      this.http.delete<AlertsConfig>(`${base}/api/v1/devices/${device}/alerts/custom/${encodeURIComponent(id)}`, { headers }),
    );
  }

  /** Lo stato delle push dal server per questo telefono (docs/adr/0047). */
  async getPush(): Promise<PushStatus> {
    return this.authorised((device, headers, base) => this.http.get<PushStatus>(`${base}/api/v1/devices/${device}/push`, { headers }));
  }

  /** Registra token APNs e chiave di cifratura. */
  async setPush(registration: PushRegistration): Promise<PushStatus> {
    return this.authorised((device, headers, base) =>
      this.http.put<PushStatus>(`${base}/api/v1/devices/${device}/push`, registration, { headers }),
    );
  }

  /** Toglie la registrazione: il server non manda più push a questo telefono. */
  async deletePush(): Promise<void> {
    await this.authorised((device, headers, base) => this.http.delete<unknown>(`${base}/api/v1/devices/${device}/push`, { headers }));
  }

  /** L'anteprima del report delle cefalee per il medico (docs/adr/0019): gli stessi dati del PDF, in JSON. */
  async getMigraineReportData(days: number): Promise<MigraineReportData> {
    return this.authorised((device, headers, base) =>
      this.http.get<MigraineReportData>(`${base}/api/v1/devices/${device}/reports/migraine/summary`, {
        headers,
        params: { days },
      }),
    );
  }

  /**
   * Il PDF del report, in base64. Non passa da `HttpClient`: il fetch di CapacitorHttp restituirebbe i byte come
   * testo e rovinerebbe il file, mentre `responseType: 'blob'` li dà in base64.
   */
  async getMigraineReportPdf(days: number): Promise<string> {
    const paired = this.credentials.paired();
    if (paired === null) {
      throw new ApiError('not-paired');
    }
    const { value } = await this.endpoint.run(async (base, timeoutMs) => {
      let response;
      try {
        response = await this.binary.get(
          `${base}/api/v1/devices/${paired.deviceId}/reports/migraine?days=${days}`,
          { Authorization: `Bearer ${paired.token}`, Accept: 'application/pdf' },
          timeoutMs ?? 30_000,
        );
      } catch {
        // Nessuna risposta: rete assente o indirizzo che non risponde. Solo questo fa passare all'indirizzo successivo.
        throw new ApiError('offline');
      }
      if (response.status === 200 && response.base64 !== '') {
        return response.base64;
      }
      throw reportError(response.status);
    });
    return value;
  }

  private async uploadInGroups<T>(
    path: string,
    field: string,
    items: readonly T[],
    size: number,
    tzOffset: number,
  ): Promise<UploadResult> {
    const total: UploadResult = { received: 0, inserted: 0, duplicates: 0 };
    for (const group of chunk(items, size)) {
      const result = await this.authorised((device, headers, base) =>
        this.http.post<UploadResult>(
          `${base}/api/v1/devices/${device}/${path}`,
          { tzOffsetMin: tzOffset, [field]: group },
          { headers },
        ),
      );
      total.received += result.received;
      total.inserted += result.inserted;
      total.duplicates += result.duplicates;
    }
    return total;
  }

  private async authorised<T>(
    call: (deviceId: string, headers: HttpHeaders, base: string) => Observable<T>,
  ): Promise<T> {
    const paired = this.credentials.paired();
    if (paired === null) {
      throw new ApiError('not-paired');
    }
    const headers = new HttpHeaders({ Authorization: `Bearer ${paired.token}` });
    const { value } = await this.send((base) => call(paired.deviceId, headers, base));
    return value;
  }

  /**
   * Una chiamata sul primo indirizzo che risponde (docs/adr/0012). Solo un errore di rete fa passare all'indirizzo
   * successivo. Ogni errore esce come `ApiError`.
   */
  private send<T>(build: (base: string) => Observable<T>, registration = false): Promise<{ value: T; route: Route }> {
    return this.endpoint.run(async (base, timeoutMs) => {
      try {
        const call = build(base);
        return await firstValueFrom(timeoutMs === null ? call : call.pipe(timeout(timeoutMs)));
      } catch (error) {
        throw error instanceof TimeoutError ? new ApiError('offline') : toApiError(error, registration);
      }
    });
  }
}

/** Il tipo di errore per lo stato HTTP di una risposta che non è il PDF. */
function reportError(status: number): ApiError {
  switch (status) {
    case 400:
      return new ApiError('rejected', status);
    case 401:
      return new ApiError('unauthorized', status);
    default:
      return new ApiError('server', status);
  }
}
