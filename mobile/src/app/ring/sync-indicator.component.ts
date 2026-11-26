import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LogoComponent } from '../brand/logo.component';
import { StartupSyncService } from '../startup/startup-sync.service';
import { RingSyncService } from './ring-sync.service';

/**
 * Il marchio che gira in cima allo schermo mentre si sincronizza fuori dall'apertura (tira per aggiornare, «Sincronizza
 * ora»). All'apertura c'è già la schermata intera, e non si mostra.
 */
@Component({
  selector: 'app-sync-indicator',
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .pill {
      position: fixed;
      top: calc(var(--ion-safe-area-top, 0px) + 8px);
      left: 50%;
      z-index: 9000;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px 8px 12px;
      border: 1px solid var(--rl-chip-border);
      border-radius: 999px;
      background: var(--rl-surface-2);
      color: var(--rl-text);
      font-size: 14px;
      line-height: 20px;
    }
  `,
  template: `
    @if (ring.syncing() && !startup.visible()) {
      <div class="pill" role="status" aria-live="polite">
        <app-logo [size]="24" [animated]="true"></app-logo>
        <span>{{ ring.step() === 'upload' ? 'Invio i dati…' : "Leggo l'anello…" }}</span>
      </div>
    }
  `,
})
export class SyncIndicatorComponent {
  protected readonly ring = inject(RingSyncService);
  protected readonly startup = inject(StartupSyncService);
}
