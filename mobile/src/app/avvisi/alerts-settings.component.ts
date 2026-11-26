import { Component, computed, inject, input, signal } from '@angular/core';
import { ChipGroupComponent } from '../shared/chip-group.component';
import { SwitchRowComponent } from '../shared/switch-row.component';
import { SettingsService } from '../settings/settings.service';
import { AlertsService } from './alerts.service';
import { PushService, pushText } from './push.service';
import {
  AlertDelivery,
  AlertLevel,
  AlertRule,
  AlertSensitivity,
  AlertsConfigPatch,
  COMPARISON_LABELS,
  CUSTOM_DAYS,
  CustomComparison,
  CustomMetric,
  CustomRule,
  CustomRuleDraft,
  DELIVERY_LABELS,
  SENSITIVITY_LABELS,
  amountRange,
  comparisonsOf,
  customRuleName,
  defaultCustomDraft,
  isAverageComparison,
  italianNumber,
  proposedQuietHours,
  proposedThresholds,
  validCustomDraft,
} from './alerts.model';

const SENSITIVITY_OPTIONS = (Object.keys(SENSITIVITY_LABELS) as AlertSensitivity[]).map((code) => ({
  code,
  label: SENSITIVITY_LABELS[code],
}));
const DELIVERY_OPTIONS = (Object.keys(DELIVERY_LABELS) as AlertDelivery[]).map((code) => ({
  code,
  label: DELIVERY_LABELS[code],
}));
const LEVEL_OPTIONS: { code: AlertLevel; label: string }[] = [
  { code: 'attenzione', label: 'Attenzione' },
  { code: 'alto', label: 'Alto' },
];
const LOCK_OPTIONS = [
  { code: 'breve', label: 'Il problema in breve' },
  { code: 'generico', label: 'Generico' },
];

/**
 * Le impostazioni degli avvisi (docs/adr/0045), in Impostazioni › Notifiche e nel passo «Avvisi» del wizard. La
 * configurazione sta sul server (ADR 0044): ogni modifica si salva subito, e senza server lo dice invece di fingere.
 * Con `propose` (wizard) la prima volta applica i valori proposti dagli Obiettivi.
 */
@Component({
  selector: 'app-alerts-settings',
  imports: [SwitchRowComponent, ChipGroupComponent],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 0 12px;
      border-top: 1px solid var(--rl-line);
    }
    h2 {
      margin: 8px 0 4px;
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--rl-muted);
    }
    .field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 52px;
      font-size: 16px;
    }
    .options {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 0 0 8px 12px;
      border-left: 2px solid var(--rl-line);
    }
    .option-label {
      font-size: 13px;
      color: var(--rl-text-2);
    }
    input,
    select {
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: var(--rl-surface);
      color: var(--rl-text);
      font: inherit;
    }
    input[type='number'] {
      width: 7em;
      text-align: right;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-muted);
    }
    .error {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--rl-warn);
    }
    button.button {
      align-self: flex-start;
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--rl-chip-border);
      border-radius: var(--rl-radius-control);
      background: none;
      color: var(--rl-text);
      font: inherit;
      font-weight: 600;
    }
    button.button:disabled {
      color: var(--rl-muted);
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .builder {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--rl-line);
      border-radius: var(--rl-radius-control);
    }
    .preview {
      margin: 0;
      font-size: 16px;
      line-height: 22px;
    }
  `,
  template: `
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
    @if (config(); as c) {
      <section aria-labelledby="avvisi-generali">
        <h2 id="avvisi-generali">Per tutti gli avvisi</h2>
        <label class="field">
          <span>Ore silenziose dalle</span>
          <input
            #quietStart
            type="time"
            [value]="c.settings.quietStart"
            (change)="saveSettings({ quietStart: quietStart.value })"
          />
        </label>
        <label class="field">
          <span>alle</span>
          <input
            #quietEnd
            type="time"
            [value]="c.settings.quietEnd"
            (change)="saveSettings({ quietEnd: quietEnd.value })"
          />
        </label>
        <p class="hint">Nelle ore silenziose le notifiche aspettano: arrivano alla fine.</p>
        <span class="option-label">Testo sulla schermata bloccata</span>
        <app-chip-group
          label="Testo sulla schermata bloccata"
          [options]="lockOptions"
          [selected]="[c.settings.lockScreen]"
          (changed)="$event[0] && saveSettings({ lockScreen: $any($event[0]) })"
        ></app-chip-group>
        <app-switch-row
          label="Anche in Home Assistant"
          description="Un'entità con quanti avvisi non hai visto e l'ultimo. Le notifiche di Home Assistant passano da servizi esterni."
          [checked]="c.settings.homeAssistant"
          (toggled)="saveSettings({ homeAssistant: $event })"
        ></app-switch-row>
      </section>

      <section aria-labelledby="avvisi-regole">
        <h2 id="avvisi-regole">Gli avvisi</h2>
        @for (rule of c.rules; track rule.id) {
          <app-switch-row
            [label]="rule.name"
            [description]="describe(rule)"
            [checked]="rule.enabled"
            (toggled)="saveRule(rule.id, { enabled: $event })"
          ></app-switch-row>
          @if (rule.enabled) {
            <div class="options" role="group" [attr.aria-label]="'Opzioni di ' + rule.name">
              @if (rule.params.sensitivity && rule.sensitivity) {
                <span class="option-label">Sensibilità</span>
                <app-chip-group
                  variant="filter"
                  [label]="'Sensibilità di ' + rule.name"
                  [options]="sensitivityOptions"
                  [selected]="[rule.sensitivity]"
                  (changed)="$event[0] && saveRule(rule.id, { sensitivity: $any($event[0]) })"
                ></app-chip-group>
              }
              @if (rule.params.days; as range) {
                <label class="field">
                  <span>Giorni di fila</span>
                  <select #days (change)="saveRule(rule.id, { days: +days.value })">
                    @for (n of range_(range.min, range.max); track n) {
                      <option [value]="n" [selected]="n === rule.days">{{ n }}</option>
                    }
                  </select>
                </label>
              }
              @if (rule.params.threshold; as t) {
                <label class="field">
                  <span>Soglia, {{ t.unit }}</span>
                  <input
                    #threshold
                    type="number"
                    inputmode="decimal"
                    [min]="t.min"
                    [max]="t.max"
                    [step]="t.step"
                    [value]="rule.threshold"
                    (change)="saveThreshold(rule, threshold)"
                  />
                </label>
              }
              <span class="option-label">Come arriva</span>
              <app-chip-group
                variant="filter"
                [label]="'Come arriva ' + rule.name"
                [options]="deliveryOptions"
                [selected]="[rule.delivery]"
                (changed)="$event[0] && saveRule(rule.id, { delivery: $any($event[0]) })"
              ></app-chip-group>
              @if (rule.delivery === 'importante') {
                <p class="hint">Passa la modalità Full immersion.</p>
              }
            </div>
          }
        }
      </section>
      @if (!wizard() && c.metrics?.length) {
        <section aria-labelledby="avvisi-tuoi">
          <h2 id="avvisi-tuoi">I tuoi avvisi</h2>
          @for (rule of c.custom ?? []; track rule.id) {
            <app-switch-row
              [label]="rule.name"
              [description]="describeCustom(rule)"
              [checked]="rule.enabled"
              (toggled)="updateCustom(rule.id, { enabled: $event })"
            ></app-switch-row>
            <div class="options" role="group" [attr.aria-label]="'Opzioni di ' + rule.name">
              @if (rule.enabled) {
                <span class="option-label">Come arriva</span>
                <app-chip-group
                  variant="filter"
                  [label]="'Come arriva ' + rule.name"
                  [options]="deliveryOptions"
                  [selected]="[rule.delivery]"
                  (changed)="$event[0] && updateCustom(rule.id, { delivery: $any($event[0]) })"
                ></app-chip-group>
              }
              <button
                type="button"
                class="button"
                [attr.aria-label]="removeLabel(rule)"
                (click)="removeCustom(rule.id)"
              >
                Togli
              </button>
            </div>
          } @empty {
            <p class="hint">
              Costruisci un avviso da una misura: per esempio «Passi sotto 3.000 per 3 giorni di fila».
            </p>
          }
          @if (draft(); as d) {
            <div class="builder" role="group" aria-label="Nuovo avviso">
              <label class="field">
                <span>Misura</span>
                <select #metric (change)="pickMetric(metric.value)">
                  @for (m of c.metrics; track m.id) {
                    <option [value]="m.id" [selected]="m.id === d.metric">{{ m.name }}</option>
                  }
                </select>
              </label>
              @if (draftMetric(); as m) {
                <span class="option-label">Confronto</span>
                <app-chip-group
                  variant="filter"
                  label="Confronto"
                  [options]="comparisonOptions(m)"
                  [selected]="[d.comparison]"
                  (changed)="$event[0] && pickComparison(m, $any($event[0]))"
                ></app-chip-group>
                @if (draftRange(); as r) {
                  <label class="field">
                    <span>{{ amountLabel(m, d.comparison) }}</span>
                    <input
                      #amount
                      type="number"
                      inputmode="decimal"
                      [min]="r.min"
                      [max]="r.max"
                      [step]="r.step"
                      [value]="d.amount"
                      (change)="setDraft({ amount: toNumber(amount.value) })"
                    />
                  </label>
                }
                <label class="field">
                  <span>{{ m.night ? 'Notti di fila' : 'Giorni di fila' }}</span>
                  <select #days (change)="setDraft({ days: +days.value })">
                    @for (n of range_(customDays.min, customDays.max); track n) {
                      <option [value]="n" [selected]="n === d.days">{{ n }}</option>
                    }
                  </select>
                </label>
                <span class="option-label">Livello</span>
                <app-chip-group
                  variant="filter"
                  label="Livello"
                  [options]="levelOptions"
                  [selected]="[d.level]"
                  (changed)="$event[0] && setDraft({ level: $any($event[0]) })"
                ></app-chip-group>
                <span class="option-label">Come arriva</span>
                <app-chip-group
                  variant="filter"
                  label="Come arriva il nuovo avviso"
                  [options]="deliveryOptions"
                  [selected]="[d.delivery]"
                  (changed)="$event[0] && setDraft({ delivery: $any($event[0]) })"
                ></app-chip-group>
                <p class="preview" aria-live="polite">{{ draftName() }}</p>
                @if (!draftValid()) {
                  <p class="error">{{ rangeHint(m, d.comparison) }}</p>
                }
                @if (isAverage(d.comparison)) {
                  <p class="hint">Confronta con la tua media: parte dall'ottava notte.</p>
                }
              }
              <div class="buttons">
                <button type="button" class="button" [disabled]="!draftValid() || saving()" (click)="createCustom()">
                  Crea l'avviso
                </button>
                <button type="button" class="button" (click)="draft.set(null)">Annulla</button>
              </div>
            </div>
          } @else {
            <button
              type="button"
              class="button"
              [disabled]="(c.custom?.length ?? 0) >= (c.maxCustom ?? 20)"
              (click)="startDraft(c.metrics[0])"
            >
              Aggiungi un avviso
            </button>
            @if ((c.custom?.length ?? 0) >= (c.maxCustom ?? 20)) {
              <p class="hint">Al massimo {{ c.maxCustom ?? 20 }} avvisi tuoi: togline uno per aggiungerne un altro.</p>
            }
          }
        </section>
      }
    } @else {
      <p class="hint">
        {{
          loading()
            ? 'Carico gli avvisi dal server…'
            : 'Collega il telefono al server di casa per scegliere gli avvisi.'
        }}
      </p>
    }

    @if (!wizard()) {
      <section aria-labelledby="avvisi-push">
        <h2 id="avvisi-push">Notifiche dal server di casa</h2>
        <p class="hint" aria-live="polite">{{ pushState() }}</p>
        @if (push.enabled()) {
          <button type="button" class="button" [disabled]="push.busy()" (click)="push.disable()">Disattiva</button>
        } @else {
          <button type="button" class="button" [disabled]="push.busy()" (click)="push.enable()">Attiva</button>
        }
      </section>

      <section aria-labelledby="avvisi-telefono">
        <h2 id="avvisi-telefono">Dal telefono</h2>
        <app-switch-row
          label="Anello non letto da 24 ore"
          description="Una notifica se per un giorno nessuno legge l'anello, anche con l'app chiusa."
          [checked]="ringWatch()"
          (toggled)="setRingWatch($event)"
        ></app-switch-row>
        <p class="hint">Gli avvisi della batteria dell'anello sono in Impostazioni › Anello.</p>
      </section>
    }
  `,
})
export class AlertsSettingsComponent {
  private readonly alerts = inject(AlertsService);
  private readonly phone = inject(SettingsService);
  protected readonly push = inject(PushService);
  protected readonly pushState = computed(() =>
    pushText(this.push.enabled(), this.push.status(), this.push.problem()),
  );

  /** Nel wizard: niente sezione del telefono, e la prima volta i valori proposti dagli Obiettivi. */
  readonly wizard = input(false);

  protected readonly config = this.alerts.config;
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly ringWatch = computed(() => this.phone.settings().background.ringWatch);
  protected readonly sensitivityOptions = SENSITIVITY_OPTIONS;
  protected readonly deliveryOptions = DELIVERY_OPTIONS;
  protected readonly lockOptions = LOCK_OPTIONS;
  protected readonly levelOptions = LEVEL_OPTIONS;
  protected readonly customDays = CUSTOM_DAYS;
  protected readonly isAverage = isAverageComparison;
  protected readonly saving = signal(false);

  /** L'avviso tuo in costruzione (docs/adr/0046), o `null` con il costruttore chiuso. */
  protected readonly draft = signal<CustomRuleDraft | null>(null);
  protected readonly draftMetric = computed(() => {
    const d = this.draft();
    return d ? (this.config()?.metrics?.find((m) => m.id === d.metric) ?? null) : null;
  });
  protected readonly draftRange = computed(() => {
    const d = this.draft();
    const m = this.draftMetric();
    return d && m ? amountRange(m, d.comparison) : null;
  });
  protected readonly draftValid = computed(() => {
    const d = this.draft();
    const m = this.draftMetric();
    return d !== null && m !== null && validCustomDraft(m, d);
  });
  protected readonly draftName = computed(() => {
    const d = this.draft();
    const m = this.draftMetric();
    return d && m ? customRuleName(m, d) : '';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const ok = await this.alerts.loadConfig();
    this.loading.set(false);
    if (ok && this.wizard()) {
      await this.propose();
    }
  }

  /** Le proposte del wizard (docs/adr/0045): ore silenziose e soglie dagli Obiettivi appena scelti. */
  private async propose(): Promise<void> {
    const s = this.phone.settings();
    const { sleepDebtHours, stepsLow } = proposedThresholds(s.sleepGoalMin, s.stepsGoal);
    const rules = new Set(this.config()?.rules.map((r) => r.id) ?? []);
    const patch: AlertsConfigPatch = {
      settings: proposedQuietHours(s.bedtime, s.wakeTime),
      rules: {},
    };
    if (rules.has('sleep-debt')) {
      patch.rules!['sleep-debt'] = { threshold: sleepDebtHours };
    }
    if (rules.has('steps-low')) {
      patch.rules!['steps-low'] = { threshold: stepsLow };
    }
    await this.save(patch);
  }

  protected describe(rule: AlertRule): string {
    return rule.usesAverage
      ? `${rule.description} Confronta con la tua media: parte dall'ottava notte.`
      : rule.description;
  }

  protected range_(min: number, max: number): number[] {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  protected saveSettings(settings: AlertsConfigPatch['settings']): void {
    void this.save({ settings });
  }

  protected saveRule(id: string, change: NonNullable<AlertsConfigPatch['rules']>[string]): void {
    void this.save({ rules: { [id]: change } });
  }

  protected saveThreshold(rule: AlertRule, field: HTMLInputElement): void {
    const t = rule.params.threshold;
    const value = Number(field.value.replace(',', '.'));
    if (!t || !Number.isFinite(value) || value < t.min || value > t.max) {
      this.error.set(t ? `La soglia va da ${t.min} a ${t.max} ${t.unit}.` : null);
      field.value = String(rule.threshold ?? '');
      return;
    }
    this.saveRule(rule.id, { threshold: value });
  }

  protected describeCustom(rule: CustomRule): string {
    const level = rule.level === 'alto' ? 'Livello alto' : 'Livello attenzione';
    return `${level}. ${DELIVERY_LABELS[rule.delivery]}.`;
  }

  protected removeLabel(rule: CustomRule): string {
    return `Togli l'avviso: ${rule.name}`;
  }

  protected comparisonOptions(metric: CustomMetric): { code: CustomComparison; label: string }[] {
    return comparisonsOf(metric).map((code) => ({ code, label: COMPARISON_LABELS[code] }));
  }

  protected amountLabel(metric: CustomMetric, comparison: CustomComparison): string {
    return isAverageComparison(comparison) ? 'Scostamenti dalla tua media' : metric.unit ? `Valore, ${metric.unit}` : 'Valore';
  }

  protected rangeHint(metric: CustomMetric, comparison: CustomComparison): string {
    const r = amountRange(metric, comparison);
    return r
      ? `Il valore va da ${italianNumber(r.min)} a ${italianNumber(r.max)}, a passi di ${italianNumber(r.step)}.`
      : '';
  }

  protected toNumber(text: string): number {
    return Number(text.replace(',', '.'));
  }

  protected startDraft(metric: CustomMetric): void {
    this.draft.set(defaultCustomDraft(metric));
  }

  protected pickMetric(id: string): void {
    const metric = this.config()?.metrics?.find((m) => m.id === id);
    if (metric) {
      const current = this.draft();
      this.draft.set({ ...defaultCustomDraft(metric), level: current?.level ?? 'attenzione', delivery: current?.delivery ?? 'notifica' });
    }
  }

  protected pickComparison(metric: CustomMetric, comparison: CustomComparison): void {
    const current = this.draft();
    if (!current) {
      return;
    }
    // Cambiando tra media e valore, la quantità di prima non ha più senso: si riparte da quella proposta.
    const sameKind = isAverageComparison(current.comparison) === isAverageComparison(comparison);
    const range = amountRange(metric, comparison);
    const amount = sameKind
      ? current.amount
      : isAverageComparison(comparison)
        ? 2
        : range
          ? Math.round((range.min + range.max) / 2 / range.step) * range.step
          : 0;
    this.draft.set({ ...current, comparison, amount });
  }

  protected setDraft(change: Partial<CustomRuleDraft>): void {
    const current = this.draft();
    if (current) {
      this.draft.set({ ...current, ...change });
    }
  }

  protected async createCustom(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.draftValid()) {
      return;
    }
    this.saving.set(true);
    const ok = await this.alerts.addCustom(draft);
    this.saving.set(false);
    this.report(ok);
    if (ok) {
      this.draft.set(null);
    }
  }

  protected updateCustom(id: string, change: Partial<CustomRuleDraft>): void {
    void this.alerts.updateCustom(id, change).then((ok) => this.report(ok));
  }

  protected removeCustom(id: string): void {
    void this.alerts.removeCustom(id).then((ok) => this.report(ok));
  }

  private report(ok: boolean): void {
    this.error.set(ok ? null : 'Non salvato: il server di casa non risponde o ha rifiutato il valore.');
  }

  protected setRingWatch(on: boolean): void {
    void this.phone.update({ background: { ...this.phone.settings().background, ringWatch: on } });
  }

  private async save(patch: AlertsConfigPatch): Promise<void> {
    this.report(await this.alerts.saveConfig(patch));
  }
}
