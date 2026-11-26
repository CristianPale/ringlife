import { Injectable, inject } from '@angular/core';
import { AlertsService } from '../../avvisi/alerts.service';
import { RingSyncService } from '../ring-sync.service';
import { BackgroundBridge } from './ring-background';

/**
 * La catena «leggi, invia, chiedi, avvisa» (docs/adr/0048): quando il raccoglitore nativo ha salvato una lettura in
 * background, la pagina web la decodifica, la invia al server e scarica gli avvisi nuovi, che diventano notifiche
 * locali. Dice al nativo a che punto è: il nativo chiude il compito in background all'ultimo passo, o allo scadere del
 * tempo. In primo piano non fa niente: legge la sincronizzazione dell'app.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundChainService {
  private readonly bridge = inject(BackgroundBridge);
  private readonly ring = inject(RingSyncService);
  private readonly alerts = inject(AlertsService);

  /** Da chiamare una volta all'avvio, solo sul telefono. */
  start(): void {
    this.bridge.onBackgroundRead(() => void this.run());
  }

  async run(): Promise<void> {
    await this.bridge.chainStep('started');
    try {
      if (!(await this.bridge.inBackground()) || this.ring.busy()) {
        await this.bridge.chainStep('skipped');
        return;
      }
      const sent = await this.ring.backgroundChain((step) => this.bridge.chainStep(step));
      if (!sent) {
        // Senza server o con un errore d'invio: i dati restano in coda, il nativo registra fin dove è arrivata.
        await this.bridge.chainStep('stop');
        return;
      }
      await this.alerts.refresh();
      await this.bridge.chainStep('alerts');
    } catch {
      await this.bridge.chainStep('failed');
    }
  }
}
