import { Component, computed, inject, input } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { RingDeviceService } from '../ring/ring-device.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { RingCardAction, describeRingCard } from './ring-card.model';
import { SettingsService } from './settings.service';

/**
 * La scheda dell'anello in cima alle Impostazioni (docs/adr/0030): chi è, com'è il firmware, e un pulsante per
 * disconnetterlo, riconnetterlo o collegarne uno.
 */
@Component({
  selector: 'app-ring-card',
  styleUrl: './ring-card.component.scss',
  template: `
    @let v = view();
    <section class="ring-card" aria-labelledby="ring-card-title">
      <div class="head">
        <div class="text">
          <h2 id="ring-card-title" class="name">{{ v.title }}</h2>
          <p class="status" role="status">{{ busy() ? "Leggo l'anello…" : v.status }}</p>
        </div>
        <svg class="art" viewBox="0 0 96 96" aria-hidden="true">
          <ellipse class="inner" cx="47" cy="48" rx="21" ry="31"></ellipse>
          <ellipse class="hole" cx="50" cy="48" rx="15" ry="25"></ellipse>
          <circle class="sensor" cx="35.5" cy="64" r="2.2"></circle>
          <circle class="sensor" cx="33.5" cy="56" r="1.6"></circle>
          <path
            class="band"
            fill-rule="evenodd"
            d="M24 48a28 38 0 1 0 56 0a28 38 0 1 0 -56 0Z M26 48a21 31 0 1 0 42 0a21 31 0 1 0 -42 0Z"
          ></path>
          <path class="shine" d="M73 24q8 24 0 48"></path>
        </svg>
      </div>
      @if (v.rows.length > 0) {
        <dl class="rows">
          @for (row of v.rows; track row.label) {
            <div class="row">
              <dt>{{ row.label }}</dt>
              <dd [class.mono]="row.mono">{{ row.value }}</dd>
            </div>
          }
        </dl>
      }
      @if (v.note; as note) {
        <p class="note">{{ note }}</p>
      }
      @if (v.action; as action) {
        <button type="button" class="action" [disabled]="busy()" (click)="act(action.kind)">{{ action.label }}</button>
      }
      @if (v.hint; as hint) {
        <p class="note">{{ hint }}</p>
      }
      @if (v.canForget) {
        <button type="button" class="forget" [disabled]="busy()" (click)="forget()">Usa un altro anello</button>
      }
    </section>
  `,
})
export class RingCardComponent {
  private readonly settings = inject(SettingsService);
  private readonly devices = inject(RingDeviceService);
  private readonly ringSync = inject(RingSyncService);

  /** Sul telefono. Nel browser non c'è Bluetooth: la scheda lo dice. */
  readonly native = input(Capacitor.isNativePlatform());

  protected readonly busy = this.ringSync.busy;
  protected readonly view = computed(() =>
    describeRingCard({
      native: this.native(),
      demo: this.settings.settings().demoRing,
      linked: this.devices.linked(),
      device: this.devices.device(),
      last: this.ringSync.last(),
      ringError: this.ringSync.ringError(),
      wear: this.settings.settings().wear,
      now: new Date(),
    }),
  );

  protected async act(kind: RingCardAction): Promise<void> {
    if (kind === 'disconnect') {
      await this.devices.unlink();
      return;
    }
    await this.devices.relink();
    await this.ringSync.sync();
  }

  protected forget(): Promise<void> {
    return this.devices.forget();
  }
}
