import { Injectable, inject } from '@angular/core';
import { DaysService } from '../api/days.service';
import { PluginsService } from '../plugins/plugins.service';
import { AlertsService } from '../avvisi/alerts.service';
import { RingSyncService } from './ring-sync.service';
import { SyncAlertService } from './sync-alert.service';

/**
 * La sincronizzazione completa a richiesta («tira per aggiornare»): legge l'anello e invia, riscarica indici e plugin,
 * e se qualcosa non è andato dice perché. Aspetta la fine di tutto.
 */
@Injectable({ providedIn: 'root' })
export class FullSyncService {
  private readonly ring = inject(RingSyncService);
  private readonly days = inject(DaysService);
  private readonly plugins = inject(PluginsService);
  private readonly alerts = inject(SyncAlertService);
  private readonly alertsService = inject(AlertsService);

  async run(): Promise<void> {
    await this.ring.sync();
    await Promise.allSettled([this.days.refresh(), this.plugins.refresh()]);
    // Gli avvisi dopo l'invio: il server li ha appena calcolati sui dati nuovi (docs/adr/0045).
    await this.alertsService.refresh();
    this.alerts.check();
  }
}
