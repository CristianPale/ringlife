import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RingChooserService, signalText } from './ring-chooser.service';

/** La finestra che chiede quale anello usare (docs/adr/0027). Sopra la schermata di avvio. */
@Component({
  selector: 'app-ring-chooser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10002;
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
      margin: 0 0 16px;
      font-size: 15px;
      line-height: 22px;
      color: var(--rl-text-2);
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
    }

    button {
      min-height: 44px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);
      font: inherit;
    }

    .ring {
      display: flex;
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 10px 16px;
      background: var(--rl-surface-2);
      text-align: left;
    }

    .name {
      font-weight: 600;
    }

    .signal {
      font-size: 14px;
      line-height: 20px;
      color: var(--rl-text-2);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
    }

    .actions button {
      padding: 0 20px;
      font-weight: 600;
    }
  `,
  template: `
    @if (chooser.request(); as choice) {
      <div class="backdrop">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="ring-chooser-title">
          @if (choice.replacing) {
            <h2 id="ring-chooser-title">È il tuo anello?</h2>
            <p>
              Non sento l'anello che usi di solito, ma ne sento un altro. Sceglilo solo se è tuo: i suoi dati andranno nel
              tuo storico.
            </p>
          } @else {
            <h2 id="ring-chooser-title">Quale anello è il tuo?</h2>
            <p>Ne sento più di uno. Se tieni il tuo vicino al telefono, è quello in cima, con il segnale più forte.</p>
          }
          <ul>
            @for (ring of choice.rings; track ring.id; let first = $first) {
              <li>
                <button type="button" class="ring" (click)="chooser.pick(ring.id)">
                  <span class="name">{{ ring.name }}</span>
                  <span class="signal">
                    {{ signal(ring.rssi) }}{{ first && ring.rssi !== null && choice.rings.length > 1 ? ', il più vicino' : '' }}
                  </span>
                </button>
              </li>
            }
          </ul>
          <div class="actions">
            <button type="button" (click)="chooser.cancel()">Annulla</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class RingChooserComponent {
  protected readonly chooser = inject(RingChooserService);
  protected readonly signal = signalText;
}
