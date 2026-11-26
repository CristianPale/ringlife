import { Component, inject, input, signal } from '@angular/core';
import { SettingsService } from '../settings/settings.service';
import { LINKED_PARAMS, followsSettings } from './linked-params';
import { PluginField, PluginView } from './plugin.model';
import { PluginsService } from './plugins.service';

/**
 * I parametri di un plugin, disegnati dal suo manifest (docs/adr/0013): un campo per ogni parametro, con il suo
 * intervallo. Al server vanno solo i valori diversi dai predefiniti, così un predefinito che cambia arriva da solo.
 * Risveglio, coricarsi e obiettivo di sonno di base seguono Obiettivi (docs/adr/0025): si possono cambiare solo qui.
 */
@Component({
  selector: 'app-plugin-config',
  styles: `
    :host {
      display: block;
      margin: 4px 0 12px;
    }
    /* Si apre con un tocco: sottolineato e con la freccia, perché non sembri un titolo. */
    summary {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary::after {
      content: '›';
      display: inline-block;
      font-size: 18px;
      line-height: 1;
      transition: transform 150ms ease-out;
    }
    details[open] > summary::after {
      transform: rotate(90deg);
    }
    .fields {
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
      border-bottom: 1px solid var(--rl-line);
    }
    .field {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 4px 12px;
      min-height: 52px;
      padding: 8px 0;
      border-top: 1px solid var(--rl-line);
    }
    .label {
      font-size: 15px;
      line-height: 20px;
      color: var(--rl-text);
    }
    .source {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 10px;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-text-2);
    }
    .value {
      font-family: var(--rl-font-mono);
      font-size: 17px;
      color: var(--rl-text);
      text-align: right;
    }
    input[type='number'],
    input[type='time'] {
      width: 96px;
      min-height: 40px;
      box-sizing: border-box;
      padding: 0 10px;
      border: 0;
      border-radius: 10px;
      background: var(--rl-surface-2);
      color: var(--rl-text);
      font-family: var(--rl-font-mono);
      font-size: 17px;
      text-align: right;
    }
    input[type='checkbox'] {
      width: 22px;
      height: 22px;
      accent-color: var(--rl-ok);
    }
    .link {
      min-height: 32px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--rl-text);
      font: inherit;
      font-size: 13px;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .error {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--rl-warn);
    }
    .hint {
      margin: 10px 0 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-muted);
    }
    .reset {
      margin-top: 4px;
    }
  `,
  template: `
    <details>
      <summary>Soglie e parametri</summary>
      <ul class="fields">
        @for (field of plugin().manifest.config; track field.key) {
          <li class="field">
            @if (field.type === 'BOOL') {
              <label class="label" [attr.for]="inputId(field)">{{ field.label }}</label>
              <input
                type="checkbox"
                [id]="inputId(field)"
                [checked]="value(field) === true"
                (change)="change(field, $any($event.target))"
              />
            } @else if (follows(field)) {
              <span class="label">{{ field.label }}</span>
              <span class="value">{{ shown(field) }}</span>
              <span class="source">
                <span>Da {{ source(field) }}</span>
                <button type="button" class="link" (click)="override(field, true)">Cambia solo qui</button>
              </span>
            } @else {
              <label class="label" [attr.for]="inputId(field)">{{ field.label }}</label>
              <input
                [id]="inputId(field)"
                [attr.type]="field.type === 'TIME' ? 'time' : 'number'"
                [attr.min]="field.min"
                [attr.max]="field.max"
                [attr.inputmode]="field.type === 'INT' ? 'numeric' : null"
                [value]="value(field)"
                (change)="change(field, $any($event.target))"
              />
              @if (linked(field)) {
                <span class="source">
                  <span>Scelto solo per questo plugin</span>
                  <button type="button" class="link" (click)="override(field, false)">Usa quello di {{ source(field) }}</button>
                </span>
              }
            }
          </li>
        }
      </ul>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <p class="hint">Sono soglie iniziali, non evidenze: cambiale se dopo qualche settimana non ti convincono.</p>
      <button type="button" class="link reset" (click)="reset()">Ripristina i predefiniti</button>
    </details>
  `,
})
export class PluginConfigComponent {
  readonly plugin = input.required<PluginView>();
  private readonly plugins = inject(PluginsService);
  private readonly settings = inject(SettingsService);
  protected readonly error = signal<string | null>(null);

  protected inputId(field: PluginField): string {
    return `${this.plugin().manifest.id}-${field.key}`;
  }

  protected linked(field: PluginField): boolean {
    return field.key in LINKED_PARAMS;
  }

  protected follows(field: PluginField): boolean {
    return followsSettings(this.plugin().manifest.id, field.key, this.settings.settings());
  }

  protected source(field: PluginField): string {
    return LINKED_PARAMS[field.key]?.source ?? '';
  }

  /** Il valore che il parametro collegato prende da Obiettivi, come si legge. */
  protected shown(field: PluginField): string {
    const value = LINKED_PARAMS[field.key].value(this.settings.settings());
    return field.key === 'sleepGoalHours' ? `${value} ore` : String(value);
  }

  protected value(field: PluginField): number | boolean | string {
    const current = this.plugin().config[field.key];
    return typeof current === 'number' || typeof current === 'boolean' || typeof current === 'string' ? current : field.defaultValue;
  }

  /** «Cambia solo qui» (`true`) o «Usa quello di Obiettivi» (`false`). Il server si allinea da sé (PluginsService). */
  protected override(field: PluginField, overridden: boolean): void {
    void this.settings.setPluginOverride(this.plugin().manifest.id, field.key, overridden);
  }

  protected async change(field: PluginField, input: HTMLInputElement): Promise<void> {
    const parsed = this.parse(field, input);
    if (parsed === null) {
      this.error.set(
        field.type === 'INT'
          ? `Il valore deve essere un numero intero tra ${field.min} e ${field.max}.`
          : 'Valore non valido.',
      );
      // Il campo torna a quello che vale davvero.
      this.restore(field, input);
      return;
    }
    // Solo i valori diversi dai predefiniti vanno al server.
    const chosen: Record<string, unknown> = {};
    for (const f of this.plugin().manifest.config) {
      const next = f.key === field.key ? parsed : this.value(f);
      if (next !== f.defaultValue) {
        chosen[f.key] = next;
      }
    }
    await this.save(chosen, () => this.restore(field, input));
  }

  /** Tutto torna ai predefiniti, e i parametri collegati tornano a seguire Obiettivi. */
  protected async reset(): Promise<void> {
    await this.settings.clearPluginOverrides(this.plugin().manifest.id);
    await this.save({}, () => undefined);
  }

  private async save(chosen: Record<string, unknown>, revert: () => void): Promise<void> {
    const ok = await this.plugins.saveConfig(this.plugin().manifest.id, chosen);
    if (ok) {
      this.error.set(null);
    } else {
      this.error.set('Non salvato: il server non risponde o ha rifiutato il valore.');
      revert();
    }
  }

  private parse(field: PluginField, input: HTMLInputElement): number | boolean | string | null {
    switch (field.type) {
      case 'BOOL':
        return input.checked;
      case 'TIME':
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(input.value) ? input.value : null;
      default: {
        const number = Number(input.value);
        const min = field.min ?? -Infinity;
        const max = field.max ?? Infinity;
        return input.value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max ? number : null;
      }
    }
  }

  private restore(field: PluginField, input: HTMLInputElement): void {
    const value = this.value(field);
    if (field.type === 'BOOL') {
      input.checked = value === true;
    } else {
      input.value = String(value);
    }
  }
}
