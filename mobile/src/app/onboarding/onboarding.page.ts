import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { ApiError, describeApiError, toApiError } from '../api/api-error';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { LogoComponent } from '../brand/logo.component';
import { BluetoothAccess, BluetoothState } from '../ring/ble/bluetooth-access';
import { RingSyncService } from '../ring/ring-sync.service';
import { RingSourceProvider } from '../ring/ring-source.provider';
import { RingDeviceService } from '../ring/ring-device.service';
import { describeRingError } from '../ring/ring-source';
import { syncedText } from '../ring/ring-status';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { SwitchRowComponent } from '../shared/switch-row.component';
import { formatThousands } from '../shared/format';
import {
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  HR_INTERVALS,
  PROFILE_LIMITS,
  ProfileNumberField,
  Sex,
  SLEEP_GOAL_MAX,
  SLEEP_GOAL_MIN,
  SLEEP_GOAL_STEP,
  STEPS_GOAL_MAX,
  STEPS_GOAL_MIN,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  normalizeServerUrl,
} from '../settings/settings.model';
import { SettingsService } from '../settings/settings.service';
import { formatHoursMinutes } from '../sonno/sonno.model';
import { AlertsSettingsComponent } from '../avvisi/alerts-settings.component';

/** I passi dell'assistente, nell'ordine (docs/adr/0022). */
export const ONBOARDING_STEPS = ['benvenuto', 'server', 'bluetooth', 'anello', 'profilo', 'misure', 'avvisi', 'prova'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const SEX_OPTIONS: readonly ChipOption[] = [
  { code: 'male', label: 'Uomo' },
  { code: 'female', label: 'Donna' },
  { code: 'unspecified', label: 'Non indicato' },
];

const SLEEP_GOALS: readonly number[] = Array.from(
  { length: (SLEEP_GOAL_MAX - SLEEP_GOAL_MIN) / SLEEP_GOAL_STEP + 1 },
  (_, i) => SLEEP_GOAL_MIN + i * SLEEP_GOAL_STEP,
);

type Check = 'idle' | 'working' | 'ok' | 'failed';

/**
 * Assistente di prima configurazione (docs/adr/0022): server, anello, profilo, misure e una prima lettura che arriva
 * al server. Senza averlo finito, sul telefono non si entra in Oggi.
 */
@Component({
  selector: 'app-onboarding',
  imports: [AlertsSettingsComponent, IonContent, LogoComponent, ChipGroupComponent, SwitchRowComponent],
  styleUrl: './onboarding.page.scss',
  template: `
    <ion-content [fullscreen]="true">
      <main class="page">
        <header class="top">
          <app-logo [size]="28" [wordmark]="true"></app-logo>
          <p class="progress" aria-live="polite">Passo {{ index() + 1 }} di {{ steps.length }}</p>
        </header>

        @switch (step()) {
          @case ('benvenuto') {
            <h1>Benvenuto</h1>
            <p>
              RingLife legge i dati del tuo anello e li trasforma in indici giornalieri: sonno, movimento e recupero,
              confrontati con la tua media. I dati restano tra il tuo telefono e il tuo server di casa.
            </p>
            <p>Ci vogliono pochi minuti: collegheremo il server e l'anello, e faremo una prima lettura di prova.</p>
            <p class="notice">
              RingLife non è un dispositivo medico. Gli indici e i suggerimenti non sono diagnosi e non sostituiscono il
              parere di un medico.
            </p>
          }
          @case ('server') {
            <h1>Il tuo server</h1>
            <p>Il server di casa conserva lo storico e calcola gli indici.</p>
            <label class="field">
              <span class="field-label">Indirizzo del server</span>
              <input
                #address
                type="url"
                inputmode="url"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                placeholder="https://ringlife.tuo-nome.ts.net"
                [value]="settings().serverUrl"
                (change)="setServer(address)"
              />
            </label>
            @if (serverInvalid()) {
              <p class="error" role="alert">L'indirizzo non è valido: deve cominciare con https:// o http://.</p>
            }
            <button type="button" class="button" [disabled]="settings().serverUrl === '' || serverCheck() === 'working'" (click)="checkServer()">
              Controlla il server
            </button>
            @switch (serverCheck()) {
              @case ('ok') {
                <p class="ok" role="status">Il server risponde.</p>
              }
              @case ('failed') {
                <p class="error" role="alert">
                  Il server non risponde. Controlla l'indirizzo e che il telefono sia sulla rete di casa o collegato a
                  Tailscale.
                </p>
              }
            }
            @if (paired()) {
              <p class="ok" role="status">Questo telefono è collegato al server.</p>
            } @else {
              <label class="field">
                <span class="field-label">Segreto di registrazione</span>
                <input #secret type="password" autocapitalize="none" autocorrect="off" spellcheck="false" />
              </label>
              <p class="hint">È la password che hai scelto nelle impostazioni dell'app RingLife sul server.</p>
              @if (pairError()) {
                <p class="error" role="alert">{{ pairError() }}</p>
              }
              <button type="button" class="button" [disabled]="pairing()" (click)="pair(secret)">Collega questo telefono</button>
            }
          }
          @case ('bluetooth') {
            <h1>Bluetooth</h1>
            <p>
              L'app parla con l'anello via Bluetooth. Il telefono ti chiederà il permesso: tocca «Consenti» nella
              finestra che compare.
            </p>
            <button type="button" class="button" [disabled]="bluetoothCheck() === 'working'" (click)="askBluetooth()">
              {{ bluetoothCheck() === 'working' ? 'Aspetto la tua risposta…' : bluetoothState() === null ? 'Consenti il Bluetooth' : 'Controlla di nuovo' }}
            </button>
            @switch (bluetoothState()) {
              @case ('granted') {
                <p class="ok" role="status">Permesso dato e Bluetooth acceso.</p>
              }
              @case ('denied') {
                <p class="error" role="alert">
                  Il permesso è negato. Apri le impostazioni dell'app, consenti il Bluetooth, poi torna qui e tocca
                  «Controlla di nuovo».
                </p>
                <button type="button" class="button" (click)="openBluetoothSettings('denied')">Apri le impostazioni</button>
              }
              @case ('off') {
                <p class="error" role="alert">
                  Il Bluetooth è spento. Accendilo dal Centro di controllo o dalle impostazioni, poi tocca «Controlla di
                  nuovo».
                </p>
                <button type="button" class="button" (click)="openBluetoothSettings('off')">Apri le impostazioni</button>
              }
            }
          }
          @case ('anello') {
            <h1>Il tuo anello</h1>
            <p>
              Tieni l'anello carico e vicino al telefono. Se l'hai usato con un'altra app (per esempio l'app del produttore), rimuovilo
              da lì e chiudila: l'anello parla con un solo telefono alla volta.
            </p>
            <button type="button" class="button" [disabled]="ringCheck() === 'working'" (click)="testRing()">
              {{ ringCheck() === 'working' ? 'Cerco l\\'anello…' : 'Cerca l\\'anello' }}
            </button>
            @switch (ringCheck()) {
              @case ('ok') {
                <p class="ok" role="status">Anello trovato. Batteria {{ ringBattery() }}%.</p>
              }
              @case ('failed') {
                <p class="error" role="alert">{{ ringError() }}</p>
              }
            }
          }
          @case ('profilo') {
            <h1>Di te e dei tuoi obiettivi</h1>
            <p>Servono a stimare le calorie e a confrontare il tuo sonno con un obiettivo. I campi del profilo sono facoltativi.</p>
            <h2>Profilo</h2>
            <app-chip-group
              variant="segment"
              label="Sesso"
              [options]="sexOptions"
              [selected]="[settings().profile.sex]"
              (changed)="setSex($event)"
            ></app-chip-group>
            <label class="field">
              <span class="field-label">Anno di nascita</span>
              <input #birth type="number" inputmode="numeric" [attr.min]="birthMin" [attr.max]="birthMax" [value]="settings().profile.birthYear ?? ''" (change)="setNumber('birthYear', birth)" />
            </label>
            <label class="field">
              <span class="field-label">Altezza (cm)</span>
              <input #height type="number" inputmode="numeric" [attr.min]="heightMin" [attr.max]="heightMax" [value]="settings().profile.heightCm ?? ''" (change)="setNumber('heightCm', height)" />
            </label>
            <label class="field">
              <span class="field-label">Peso (kg)</span>
              <input #weight type="number" inputmode="decimal" [attr.min]="weightMin" [attr.max]="weightMax" [value]="settings().profile.weightKg ?? ''" (change)="setNumber('weightKg', weight)" />
            </label>
            <h2>Obiettivi e orari</h2>
            <label class="field">
              <span class="field-label">Sonno che vuoi fare</span>
              <select #goal (change)="setSleepGoal(goal.value)">
                @for (minutes of sleepGoals; track minutes) {
                  <option [value]="minutes" [selected]="minutes === settings().sleepGoalMin">{{ hours(minutes) }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span class="field-label">Passi al giorno</span>
              <input #steps type="number" inputmode="numeric" [attr.min]="stepsMin" [attr.max]="stepsMax" [value]="settings().stepsGoal" (change)="setSteps(steps)" />
            </label>
            <label class="field">
              <span class="field-label">Di solito vai a letto alle</span>
              <input #bed type="time" [value]="settings().bedtime" (change)="setTime('bedtime', bed)" />
            </label>
            <label class="field">
              <span class="field-label">Di solito ti svegli alle</span>
              <input #wake type="time" [value]="settings().wakeTime" (change)="setTime('wakeTime', wake)" />
            </label>
          }
          @case ('misure') {
            <h1>Le misure dell'anello</h1>
            <p>L'anello misura da solo durante il giorno e la notte. Più misure danno indici migliori e consumano più batteria.</p>
            <label class="field">
              <span class="field-label">Battito: una misura ogni</span>
              <select #interval (change)="setInterval(interval.value)">
                @for (minutes of hrIntervals; track minutes) {
                  <option [value]="minutes" [selected]="minutes === settings().ring.hrIntervalMin">{{ minutes }} {{ minutes === 1 ? 'minuto' : 'minuti' }}</option>
                }
              </select>
            </label>
            <app-switch-row
              label="Stress"
              description="Una stima di quanto è stata tesa la giornata."
              [checked]="settings().ring.stress"
              (toggled)="setRing({ stress: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Ossigeno nel sangue (SpO2)"
              description="Misurato soprattutto di notte, per il respiro notturno."
              [checked]="settings().ring.spo2"
              (toggled)="setRing({ spo2: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Variabilità del battito (HRV)"
              description="Quanto varia il tempo tra un battito e l'altro: misura il recupero. Soprattutto di notte."
              [checked]="settings().ring.hrv"
              (toggled)="setRing({ hrv: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Temperatura"
              description="Temperatura della pelle del dito. Conta solo quanto si scosta dalla tua media."
              [checked]="settings().ring.temperature"
              (toggled)="setRing({ temperature: $event })"
            ></app-switch-row>
            <p class="hint">Le scelte si scrivono sull'anello durante la prima lettura.</p>
          }
          @case ('avvisi') {
            <!-- Avvisi (docs/adr/0045): i predefiniti, con ore silenziose e soglie proposte dagli Obiettivi. -->
            <h1>Avvisi</h1>
            <p>
              RingLife ti avvisa quando un valore è lontano dal tuo solito, o se l'anello non viene letto. Questi sono i
              predefiniti, con le ore silenziose e le soglie calcolate dai tuoi obiettivi: cambiali qui o più tardi in
              Impostazioni › Notifiche.
            </p>
            <app-alerts-settings [wizard]="true"></app-alerts-settings>
          }
          @case ('prova') {
            <h1>Prima lettura</h1>
            <p>Leggiamo l'anello e inviamo i dati al server, per controllare che tutto il percorso funzioni.</p>
            <button type="button" class="button" [disabled]="sync.syncing()" (click)="runSync()">
              {{ sync.syncing() ? 'Sto leggendo…' : 'Sincronizza ora' }}
            </button>
            @if (sync.ringError(); as message) {
              <p class="error" role="alert">{{ message }}</p>
            }
            @if (sync.uploadError(); as error) {
              <p class="error" role="alert">{{ uploadText(error) }}</p>
            }
            @if (syncOk()) {
              <p class="ok" role="status">Tutto a posto: {{ syncSummary() }}</p>
            }
          }
        }

        <nav class="actions" aria-label="Passi">
          @if (index() > 0) {
            <button type="button" class="button secondary" (click)="back()">Indietro</button>
          }
          @if (step() === 'prova') {
            <button type="button" class="button primary" [disabled]="!canContinue()" (click)="finish()">Entra in RingLife</button>
          } @else {
            <button type="button" class="button primary" [disabled]="!canContinue()" (click)="next()">
              {{ step() === 'benvenuto' ? 'Inizia' : 'Continua' }}
            </button>
          }
        </nav>
        @if (!canContinue() && hint()) {
          <p class="hint center" role="status">{{ hint() }}</p>
        }
      </main>
    </ion-content>
  `,
})
export class OnboardingPage {
  private readonly router = inject(Router);
  private readonly api = inject(RingLifeApi);
  private readonly credentials = inject(CredentialsService);
  private readonly sources = inject(RingSourceProvider);
  private readonly devices = inject(RingDeviceService);
  private readonly bluetooth = inject(BluetoothAccess);
  private readonly service = inject(SettingsService);
  protected readonly sync = inject(RingSyncService);

  protected readonly steps = ONBOARDING_STEPS;
  protected readonly settings = this.service.settings;
  protected readonly paired = this.credentials.paired;

  protected readonly index = signal(0);
  protected readonly step = computed<OnboardingStep>(() => ONBOARDING_STEPS[this.index()]);

  protected readonly serverInvalid = signal(false);
  protected readonly serverCheck = signal<Check>('idle');
  protected readonly pairing = signal(false);
  protected readonly pairError = signal<string | null>(null);
  protected readonly bluetoothCheck = signal<Check>('idle');
  /** `null` finché non si è chiesto il permesso. */
  protected readonly bluetoothState = signal<BluetoothState | null>(null);
  protected readonly ringCheck = signal<Check>('idle');
  protected readonly ringBattery = signal(0);
  protected readonly ringError = signal<string | null>(null);
  /** La prova di sincronizzazione è stata lanciata da questo assistente. */
  private readonly syncTried = signal(false);

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly sleepGoals = SLEEP_GOALS;
  protected readonly hrIntervals = HR_INTERVALS;
  protected readonly birthMin = BIRTH_YEAR_MIN;
  protected readonly birthMax = BIRTH_YEAR_MAX;
  protected readonly heightMin = HEIGHT_MIN_CM;
  protected readonly heightMax = HEIGHT_MAX_CM;
  protected readonly weightMin = WEIGHT_MIN_KG;
  protected readonly weightMax = WEIGHT_MAX_KG;
  protected readonly stepsMin = STEPS_GOAL_MIN;
  protected readonly stepsMax = STEPS_GOAL_MAX;

  /** Una lettura riuscita fino al server: né l'anello né l'invio hanno dato errore e l'anello ha risposto. */
  protected readonly syncOk = computed(
    () => this.syncTried() && !this.sync.syncing() && this.sync.ringError() === null && this.sync.uploadError() === null && this.sync.last() !== null,
  );

  protected readonly canContinue = computed(() => {
    switch (this.step()) {
      case 'server':
        return this.paired() !== null;
      case 'bluetooth':
        return this.bluetoothState() === 'granted';
      case 'anello':
        return this.ringCheck() === 'ok';
      case 'prova':
        return this.syncOk();
      default:
        return true;
    }
  });

  /** Perché «Continua» è spento, in una frase. */
  protected readonly hint = computed(() => {
    switch (this.step()) {
      case 'server':
        return 'Collega il telefono al server per continuare.';
      case 'bluetooth':
        return 'Consenti il Bluetooth per continuare.';
      case 'anello':
        return "Trova l'anello per continuare.";
      case 'prova':
        return 'Per entrare serve una lettura riuscita.';
      default:
        return '';
    }
  });

  protected next(): void {
    if (this.canContinue() && this.index() < ONBOARDING_STEPS.length - 1) {
      this.index.update((i) => i + 1);
    }
  }

  protected back(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  protected async finish(): Promise<void> {
    if (!this.canContinue()) {
      return;
    }
    await this.service.update({ onboarded: true });
    await this.router.navigateByUrl('/tabs/oggi', { replaceUrl: true });
  }

  // ---- Server ---------------------------------------------------------------------------------------------------

  protected setServer(input: HTMLInputElement): void {
    const typed = input.value.trim();
    const normalized = normalizeServerUrl(typed);
    if (typed !== '' && normalized === '') {
      this.serverInvalid.set(true);
      return;
    }
    this.serverInvalid.set(false);
    if (normalized !== this.settings().serverUrl) {
      // L'accesso appartiene al server per cui è stato rilasciato: un altro indirizzo parte da zero.
      void this.credentials.forget();
      this.serverCheck.set('idle');
      this.pairError.set(null);
    }
    void this.service.update({ serverUrl: normalized });
    input.value = normalized;
  }

  protected async checkServer(): Promise<void> {
    this.serverCheck.set('working');
    this.serverCheck.set((await this.api.healthRoute()) !== null ? 'ok' : 'failed');
  }

  protected async pair(secret: HTMLInputElement): Promise<void> {
    if (secret.value.trim() === '') {
      this.pairError.set('Inserisci il segreto di registrazione.');
      return;
    }
    this.pairing.set(true);
    this.pairError.set(null);
    try {
      await this.api.register(secret.value);
      secret.value = '';
      this.serverCheck.set('ok');
    } catch (error) {
      this.pairError.set(describeApiError(error instanceof ApiError ? error.kind : toApiError(error).kind));
    } finally {
      this.pairing.set(false);
    }
  }

  // ---- Bluetooth -------------------------------------------------------------------------------------------------

  /** Chiede il permesso e aspetta la risposta: il passo non va avanti finché il Bluetooth non è utilizzabile. */
  protected async askBluetooth(): Promise<void> {
    this.bluetoothCheck.set('working');
    this.bluetoothState.set(await this.bluetooth.request());
    this.bluetoothCheck.set(this.bluetoothState() === 'granted' ? 'ok' : 'failed');
  }

  protected openBluetoothSettings(state: 'denied' | 'off'): Promise<void> {
    return this.bluetooth.openSettings(state);
  }

  // ---- Anello ---------------------------------------------------------------------------------------------------

  /** Si collega, legge la batteria e si scollega: la prova che il Bluetooth, i permessi e l'anello ci sono. */
  protected async testRing(): Promise<void> {
    // L'assistente prova sempre l'anello vero, mai quello di prova.
    if (this.settings().demoRing) {
      await this.service.update({ demoRing: false });
    }
    // Cercarlo qui vuol dire volerlo usare: un anello scollegato da RingLife si ricollega (docs/adr/0030).
    await this.devices.relink();
    this.ringCheck.set('working');
    this.ringError.set(null);
    const source = this.sources.current();
    try {
      await source.connect();
      this.ringBattery.set((await source.battery()).percent);
      this.ringCheck.set('ok');
    } catch (error) {
      this.ringError.set(describeRingError(error));
      this.ringCheck.set('failed');
    } finally {
      try {
        await source.disconnect();
      } catch {
        // Già scollegato.
      }
    }
  }

  // ---- Profilo, obiettivi, misure --------------------------------------------------------------------------------

  protected hours(minutes: number): string {
    return formatHoursMinutes(minutes);
  }

  protected setSex(codes: string[]): void {
    if (codes.length > 0) {
      void this.service.updateProfile({ sex: codes[0] as Sex });
    }
  }

  protected setNumber(field: ProfileNumberField, input: HTMLInputElement): void {
    const text = input.value.trim();
    if (text === '') {
      void this.service.updateProfile({ [field]: null });
      return;
    }
    const value = Number(text);
    const [min, max] = PROFILE_LIMITS[field];
    if (!Number.isFinite(value) || value < min || value > max) {
      const current = this.settings().profile[field];
      input.value = current === null ? '' : String(current);
      return;
    }
    void this.service.updateProfile({ [field]: value });
  }

  protected setSleepGoal(value: string): void {
    void this.service.update({ sleepGoalMin: Number(value) });
  }

  protected setSteps(input: HTMLInputElement): void {
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value)) {
      input.value = String(this.settings().stepsGoal);
      return;
    }
    void this.service.update({ stepsGoal: value }).then(() => (input.value = String(this.settings().stepsGoal)));
  }

  protected setTime(field: 'bedtime' | 'wakeTime', input: HTMLInputElement): void {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) {
      void this.service.update({ [field]: input.value });
    } else {
      input.value = this.settings()[field];
    }
  }

  protected setInterval(value: string): void {
    void this.service.updateRing({ hrIntervalMin: Number(value) });
  }

  protected setRing(patch: { stress?: boolean; spo2?: boolean; hrv?: boolean; temperature?: boolean }): void {
    void this.service.updateRing(patch);
  }

  // ---- Prova -----------------------------------------------------------------------------------------------------

  protected async runSync(): Promise<void> {
    this.syncTried.set(true);
    await this.sync.sync();
  }

  protected uploadText(error: ApiError): string {
    return describeApiError(error.kind);
  }

  protected syncSummary(): string {
    const last = this.sync.last();
    if (!last) {
      return '';
    }
    const battery = last.battery === null ? '' : `batteria ${last.battery}%, `;
    return `${battery}${syncedText(last.at, new Date()).toLowerCase()}. ${this.sync.pending() === 0 ? 'Nessun dato in attesa.' : `${formatThousands(this.sync.pending())} dati in attesa di invio.`}`;
  }
}
