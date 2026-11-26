import { Component, computed, inject, signal } from '@angular/core';
import { describeApiError } from '../api/api-error';
import { REPORT_PERIODS, ReportPeriod } from '../api/api.model';
import { CredentialsService } from '../api/credentials.service';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { MigraineReportService } from './migraine-report.service';
import { previewLines } from './report-preview';

const OPTIONS: readonly ChipOption[] = REPORT_PERIODS.map((days) => ({ code: String(days), label: `${days} giorni` }));

/**
 * «Report per il medico» (docs/adr/0019), nella pagina del plugin Emicrania: si sceglie il periodo, si vede
 * che cosa conterrà il PDF e poi lo si condivide. Non parte mai da solo.
 */
@Component({
  selector: 'app-migraine-report',
  imports: [ChipGroupComponent],
  styles: `
    :host {
      display: block;
    }
    .title {
      margin: 0;
      font-family: var(--rl-font-voice);
      font-size: 22px;
      line-height: 28px;
      font-weight: 500;
    }
    .hint {
      margin: 4px 0 8px;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-muted);
    }
    ul {
      margin: 8px 0;
      padding-left: 18px;
      font-size: 14px;
      line-height: 20px;
    }
    .button {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: transparent;
      color: var(--rl-text);
      font: inherit;
      font-size: 15px;
    }
    .button:disabled {
      opacity: 0.5;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .error {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--rl-zone-alto);
    }
  `,
  template: `
    <p class="title">Report per il medico</p>
    <p class="hint">
      Un PDF con i numeri delle tue cefalee e un episodio per riga. Non contiene note, nome o altri dati personali.
      Lo condividi tu, con la mail o l'app che scegli.
    </p>
    @if (!paired()) {
      <p class="hint" role="status">Serve un server collegato: il report si crea sul server.</p>
    } @else {
      <app-chip-group
        label="Periodo"
        [options]="options"
        [selected]="[period().toString()]"
        (changed)="setPeriod($event)"
      ></app-chip-group>
      <div class="actions">
        <button type="button" class="button" [disabled]="report.loading() || report.sharing()" (click)="load()">
          {{ report.loading() ? 'Carico…' : 'Mostra anteprima' }}
        </button>
      </div>
      @if (report.preview(); as data) {
        <ul aria-label="Contenuto del report">
          @for (line of lines(); track line) {
            <li>{{ line }}</li>
          }
        </ul>
        <p class="hint">RingLife non è un dispositivo medico: il report non contiene diagnosi né consigli su farmaci.</p>
        <div class="actions">
          <button type="button" class="button" [disabled]="report.sharing() || report.loading()" (click)="share()">
            {{ report.sharing() ? 'Preparo il PDF…' : 'Condividi PDF' }}
          </button>
        </div>
      }
      @if (errorText(); as text) {
        <p class="error" role="alert">{{ text }}</p>
      }
    }
  `,
})
export class MigraineReportComponent {
  protected readonly report = inject(MigraineReportService);
  private readonly credentials = inject(CredentialsService);

  protected readonly options = OPTIONS;
  protected readonly period = signal<ReportPeriod>(90);
  protected readonly paired = computed(() => this.credentials.paired() !== null);
  protected readonly lines = computed(() => {
    const data = this.report.preview();
    return data ? previewLines(data) : [];
  });
  protected readonly errorText = computed(() => {
    const error = this.report.error();
    return error ? `Report non riuscito. ${describeApiError(error.kind)}` : null;
  });

  protected setPeriod(codes: string[]): void {
    const days = Number(codes[0]);
    if ((REPORT_PERIODS as readonly number[]).includes(days) && days !== this.period()) {
      this.period.set(days as ReportPeriod);
      // L'anteprima era di un altro periodo.
      this.report.clear();
    }
  }

  protected load(): void {
    void this.report.load(this.period());
  }

  protected share(): void {
    void this.report.share(this.period());
  }
}
