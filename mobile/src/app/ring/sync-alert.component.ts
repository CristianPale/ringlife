import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SyncAlertService } from './sync-alert.service';

/** La finestra che dice perché la sincronizzazione non è riuscita. Sopra la schermata di avvio. */
@Component({
  selector: 'app-sync-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.55);
    }

    .dialog {
      box-sizing: border-box;
      width: 100%;
      max-width: 360px;
      max-height: 80dvh;
      overflow-y: auto;
      padding: 20px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-sheet);
      background: var(--rl-surface);
      color: var(--rl-text);
    }

    h2 {
      margin: 0 0 12px;
      font-family: var(--rl-font-voice);
      font-size: 22px;
      line-height: 28px;
      font-weight: 500;
    }

    p {
      margin: 0 0 12px;
      font-size: 15px;
      line-height: 22px;
      color: var(--rl-text-2);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 8px;
    }

    button {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);
      font: inherit;
      font-weight: 600;
    }

    button.primary {
      border-color: transparent;
      background: var(--rl-surface-2);
    }
  `,
  template: `
    @if (alerts.problems(); as problems) {
      <div class="backdrop">
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-alert-title">
          <h2 id="sync-alert-title">Sincronizzazione non riuscita</h2>
          @for (problem of problems; track $index) {
            <p>{{ problem }}</p>
          }
          <div class="actions">
            <button type="button" (click)="alerts.dismiss()">Chiudi</button>
            <button type="button" class="primary" (click)="alerts.retry()">Riprova</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SyncAlertComponent {
  protected readonly alerts = inject(SyncAlertService);
}
