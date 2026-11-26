import { Injectable, inject, signal } from '@angular/core';
import { ApiError, toApiError } from '../api/api-error';
import { MigraineReportData, ReportPeriod } from '../api/api.model';
import { RingLifeApi } from '../api/ringlife-api';
import { FileShare } from './file-share';

const FILE_PREFIX = 'report-cefalee-';

/**
 * Il report delle cefalee per il medico (docs/adr/0019): anteprima dei dati, poi il PDF dal server e il pannello di
 * condivisione del sistema. Sempre un gesto dell'utente. Il file temporaneo si cancella subito dopo.
 */
@Injectable({ providedIn: 'root' })
export class MigraineReportService {
  private readonly api = inject(RingLifeApi);
  private readonly files = inject(FileShare);

  readonly preview = signal<MigraineReportData | null>(null);
  readonly loading = signal(false);
  readonly sharing = signal(false);
  readonly error = signal<ApiError | null>(null);

  /** Carica i dati del periodo. Un errore lascia l'anteprima di prima. */
  async load(days: ReportPeriod): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.preview.set(await this.api.getMigraineReportData(days));
    } catch (error) {
      this.error.set(error instanceof ApiError ? error : toApiError(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Scarica il PDF del periodo e lo condivide. `true` se è arrivato al pannello di condivisione. */
  async share(days: ReportPeriod, today: Date = new Date()): Promise<boolean> {
    this.sharing.set(true);
    this.error.set(null);
    let uri: string | null = null;
    try {
      const pdf = await this.api.getMigraineReportPdf(days);
      const name = `${FILE_PREFIX}${today.toISOString().slice(0, 10)}.pdf`;
      uri = await this.files.save(name, pdf);
      await this.files.share(uri, name);
      return true;
    } catch (error) {
      this.error.set(error instanceof ApiError ? error : toApiError(error));
      return false;
    } finally {
      if (uri) {
        await this.files.remove(uri);
      }
      this.sharing.set(false);
    }
  }

  /** All'avvio: toglie i report rimasti da una condivisione interrotta. */
  cleanup(): Promise<void> {
    return this.files.cleanup(FILE_PREFIX);
  }

  clear(): void {
    this.preview.set(null);
    this.error.set(null);
  }
}
