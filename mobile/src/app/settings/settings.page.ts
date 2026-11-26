import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { tzOffsetMin } from '../api/api.model';
import { ApiError, describeApiError, toApiError } from '../api/api-error';
import { CredentialsService } from '../api/credentials.service';
import { buildDemoData } from '../api/demo-data';
import { RingLifeApi } from '../api/ringlife-api';
import { PluginConfigComponent } from '../plugins/plugin-config.component';
import { PluginsService } from '../plugins/plugins.service';
import { Route } from '../api/server-endpoint';
import { DiarySyncService } from '../diary/diary-sync.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { syncedText } from '../ring/ring-status';
import { describeAttempt } from '../ring/background/background-attempts';
import { BackgroundBridge } from '../ring/background/ring-background';
import { OggiDataService } from '../oggi/oggi-data.service';
import { OGGI_SAMPLE } from '../oggi/oggi.sample';
import { formatThousands } from '../shared/format';
import { LogoComponent } from '../brand/logo.component';
import { ChipGroupComponent, ChipOption } from '../shared/chip-group.component';
import { SwitchRowComponent } from '../shared/switch-row.component';
import { RingDeviceService } from '../ring/ring-device.service';
import { firmwareLabel, firmwareNote } from '../ring/ring-device.model';
import { RingCardComponent } from './ring-card.component';
import { formatHoursMinutes } from '../sonno/sonno.model';
import {
  BACKGROUND_INTERVALS,
  HR_INTERVALS,
  PLUGIN_IDS,
  PluginId,
  SLEEP_GOAL_MAX,
  SLEEP_GOAL_MIN,
  SLEEP_GOAL_STEP,
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  PROFILE_LIMITS,
  ProfileNumberField,
  Sex,
  WearFinger,
  WearHand,
  STEPS_GOAL_MAX,
  STEPS_GOAL_MIN,
  ThemeChoice,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  isValidTime,
  normalizeHomeUrl,
  normalizeServerUrl,
} from './settings.model';
import { SettingsService } from './settings.service';
import { HabitualCaffeineService } from '../diary/habitual-caffeine.service';
import { HabitualCaffeine, MAX_HABITS } from '../diary/habits';
import { CaffeineDrink } from '../diary/journal.model';
import { CAFFEINE_OPTIONS, caffeineServing } from '../diary/journal-labels';
import { PLUGIN_GUIDE } from '../guida/guide';
import { AlertsSettingsComponent } from '../avvisi/alerts-settings.component';
import { AlertsService } from '../avvisi/alerts.service';

export const APP_VERSION = '1.1.0';

const THEME_OPTIONS: readonly ChipOption[] = [
  { code: 'system', label: 'Sistema' },
  { code: 'dark', label: 'Scuro' },
  { code: 'light', label: 'Chiaro' },
];

const HAND_OPTIONS: readonly ChipOption[] = [
  { code: 'left', label: 'Sinistra' },
  { code: 'right', label: 'Destra' },
];

const FINGER_OPTIONS: readonly ChipOption[] = [
  { code: 'index', label: 'Indice' },
  { code: 'middle', label: 'Medio' },
  { code: 'ring', label: 'Anulare' },
];

/** Per quanto, dopo un cambio di mano o dito, si ricorda che le misure possono scostarsi. */
const WEAR_NOTICE_MS = 14 * 86_400_000;
const WEAR_DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

const SEX_OPTIONS: readonly ChipOption[] = [
  { code: 'male', label: 'Uomo' },
  { code: 'female', label: 'Donna' },
  { code: 'unspecified', label: 'Non indicato' },
];

const PLUGIN_INFO: Record<PluginId, { name: string; description: string }> = {
  migraine: { name: 'Emicrania', description: 'Soglie e punti del rischio' },
  'caffeine-window': { name: 'Finestra caffeina', description: 'Inizio e stop dal risveglio' },
  circadian: { name: 'Ritmo circadiano', description: 'Punto medio del sonno e luce del mattino' },
  'social-jetlag': { name: 'Jet lag sociale', description: 'Quanto si sposta il sonno nel fine settimana' },
  'vitamin-d': { name: 'Vitamina D', description: "Minuti al sole con l'indice UV di casa" },
  'weekly-report': { name: 'Report settimanale', description: 'Sonno, movimento e recupero a confronto con la settimana prima, in Oggi' },
  training: { name: 'Allenamento e respirazione', description: 'Allenamento con le zone del battito e respirazione guidata' },
};

const SLEEP_GOALS: readonly number[] = Array.from(
  { length: (SLEEP_GOAL_MAX - SLEEP_GOAL_MIN) / SLEEP_GOAL_STEP + 1 },
  (_, i) => SLEEP_GOAL_MIN + i * SLEEP_GOAL_STEP,
);

export type SettingsSectionId = 'anello' | 'obiettivi' | 'abitudini' | 'profilo' | 'plugin' | 'notifiche' | 'server' | 'aspetto';

/** Le sezioni delle impostazioni, nell'ordine dell'elenco. Ognuna è una pagina: `/impostazioni/<id>`. */
export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; title: string }[] = [
  { id: 'anello', title: 'Anello' },
  { id: 'obiettivi', title: 'Obiettivi' },
  { id: 'abitudini', title: 'Abitudini' },
  { id: 'profilo', title: 'Profilo' },
  { id: 'plugin', title: 'Plugin' },
  { id: 'notifiche', title: 'Notifiche' },
  { id: 'server', title: 'Server di casa' },
  { id: 'aspetto', title: 'Aspetto' },
];

/** «1 caffè alle 08:00». */
export function habitText(habit: HabitualCaffeine): string {
  return `${caffeineServing(habit.drink)} alle ${habit.time}`;
}

/**
 * Impostazioni: un elenco di sezioni (anello, obiettivi, abitudini, profilo, plugin, server di casa, aspetto) e una pagina per
 * ciascuna. Ogni modifica si salva subito. Anello, plugin e server memorizzano le scelte: le useranno la
 * sincronizzazione e il backend.
 */
@Component({
  selector: 'app-settings',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    RouterLink,
    LogoComponent,
    ChipGroupComponent,
    SwitchRowComponent,
    PluginConfigComponent,
    RingCardComponent,
    AlertsSettingsComponent,
  ],
  styleUrl: './settings.page.scss',
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            [defaultHref]="current() ? '/impostazioni' : '/tabs/oggi'"
            text=""
            [attr.aria-label]="current() ? 'Indietro a Impostazioni' : 'Indietro a Oggi'"
          ></ion-back-button>
        </ion-buttons>
        <ion-title>{{ current()?.title ?? 'Impostazioni' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="page">
        @if (!current()) {
          <app-ring-card></app-ring-card>

          <nav aria-label="Sezioni delle impostazioni">
            <ul class="menu">
              @for (item of menu(); track item.id) {
                <li>
                  <a class="menu-link" [routerLink]="'/impostazioni/' + item.id">
                    <span class="menu-text">
                      <span class="menu-title">{{ item.title }}</span>
                      <span class="menu-summary">{{ item.summary }}</span>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                  </a>
                </li>
              }
            </ul>
          </nav>

          <ul class="menu" aria-label="Aiuto">
            <li>
              <a class="menu-link" routerLink="/guida">
                <span class="menu-text">
                  <span class="menu-title">Guida</span>
                  <span class="menu-summary">Che cosa vuol dire ogni numero e come si calcola</span>
                </span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
              </a>
            </li>
          </ul>
        }

        @if (current()?.id === 'anello') {
        <section aria-labelledby="anello">
          <h2 id="anello" class="section-title sr-only">Anello</h2>
          <div class="card">
            <p class="ring-status">Batteria {{ battery() }}%{{ ringSync.charging() ? ', in carica' : '' }} · {{ syncText() }}</p>
            @if (!devices.linked() && !s().demoRing) {
              <p class="hint">Anello scollegato da RingLife: per leggerlo tocca Riconnetti nella scheda in cima alle Impostazioni.</p>
            } @else if (!ringSync.hasRing()) {
              <p class="hint">Dati di esempio: l'anello non è ancora collegato.</p>
            }
            <button type="button" class="button" [disabled]="!ringSync.active() || ringSync.syncing()" aria-describedby="sync-hint" (click)="syncNow()">
              {{ ringSync.syncing() ? 'Sincronizzo…' : 'Sincronizza ora' }}
            </button>
            <p id="sync-hint" class="hint" role="status">{{ ringSyncText() }}</p>
            @for (warning of ringWarnings(); track warning) {
              <p class="hint" role="status">{{ warning }}</p>
            }
            <app-switch-row
              label="Anello di prova"
              description="Usa dati inventati al posto dell'anello, per provare il percorso fino al server. Non sono dati tuoi."
              [checked]="s().demoRing"
              (toggled)="setDemoRing($event)"
            ></app-switch-row>

            <label class="field">
              <span class="field-label">Misura del battito</span>
              <select [value]="s().ring.hrIntervalMin" (change)="setInterval($any($event.target).value)">
                @for (minutes of hrIntervals; track minutes) {
                  <option [value]="minutes" [selected]="minutes === s().ring.hrIntervalMin">ogni {{ minutes }} min</option>
                }
              </select>
            </label>
            <app-switch-row
              label="Misura dello stress"
              description="L'anello stima il livello di stress dal battito."
              [checked]="s().ring.stress"
              (toggled)="setRing({ stress: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Misura dell'ossigeno nel sangue (SpO2)"
              description="La saturazione di ossigeno, in percentuale. Serve al respiro notturno."
              [checked]="s().ring.spo2"
              (toggled)="setRing({ spo2: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Variabilità del battito (HRV)"
              description="Quanto varia il tempo tra un battito e l'altro: misura il recupero. Soprattutto di notte."
              [checked]="s().ring.hrv"
              (toggled)="setRing({ hrv: $event })"
            ></app-switch-row>
            <app-switch-row
              label="Temperatura"
              description="Temperatura della pelle del dito. Conta solo quanto si scosta dalla tua media."
              [checked]="s().ring.temperature"
              (toggled)="setRing({ temperature: $event })"
            ></app-switch-row>
            <p class="hint">
              Le misure scelte si applicano alla prossima sincronizzazione. A ogni lettura l'app controlla che l'anello le
              abbia ancora accese, e le riaccende se le ha perse.
              @if (measuresRestoredText(); as text) {
                {{ text }}
              }
            </p>
            <div class="field">
              <span class="field-label">Firmware</span>
              <span class="value">{{ firmware() ?? 'non ancora letto' }}</span>
            </div>
            <p class="hint">{{ firmwareText() }}</p>
            <p class="field-label">Mano</p>
            <app-chip-group
              variant="segment"
              label="Mano"
              [options]="handOptions"
              [selected]="[s().wear.hand]"
              (changed)="setWear('hand', $event)"
            ></app-chip-group>
            <p class="field-label">Dito</p>
            <app-chip-group
              variant="segment"
              label="Dito"
              [options]="fingerOptions"
              [selected]="[s().wear.finger]"
              (changed)="setWear('finger', $event)"
            ></app-chip-group>
            <p class="hint">
              All'anello non serve saperlo. Conta per i tuoi dati: di solito si consiglia l'indice della mano che usi di meno,
              con l'anello ben aderente. Ogni dito ha la sua temperatura, e se cambi mano o dito per qualche giorno
              temperatura e battito possono scostarsi dalla tua media.
              @if (wearChangedText(); as text) {
                {{ text }}
              }
            </p>
            <label class="field">
              <span class="field-label">Lettura in background</span>
              <select [value]="s().background.intervalMin" (change)="setBackground({ intervalMin: +$any($event.target).value })">
                @for (minutes of backgroundIntervals; track minutes) {
                  <option [value]="minutes" [selected]="minutes === s().background.intervalMin">{{ backgroundLabel(minutes) }}</option>
                }
              </select>
            </label>
            <p class="hint">
              Con l'app chiusa il telefono legge l'anello al massimo con questa frequenza: decide iOS quando, di solito ogni una o
              due ore, e una volta dopo il risveglio abituale. Dopo ogni lettura prova a inviare i dati al server e a controllare
              gli avvisi. Se chiudi l'app scorrendola via, riparte solo quando la riapri: per leggere anche allora servono le
              automazioni di Comandi.
              @if (lastBackgroundText(); as text) {
                {{ text }}
              }
            </p>
            <a class="plugin-guide" routerLink="/guida/automazioni">Quali automazioni di Comandi creare</a>
            <button type="button" class="button" (click)="openShortcuts()">Apri Comandi</button>
            @if (backgroundAttempts().length > 0) {
              <p class="field-label">Ultimi tentativi in background</p>
              <ul class="attempts">
                @for (line of backgroundAttempts(); track $index) {
                  <li>{{ line }}</li>
                }
              </ul>
              <p class="hint">
                iOS sono le letture che decide il telefono, Comandi quelle delle tue automazioni. Una lettura ha tra 18 e 25
                secondi: se si ferma sempre allo stesso punto, quel punto è il problema.
              </p>
            }
            <app-switch-row
              label="Avvisi della batteria"
              description="Una notifica quando l'anello scende al 20% e al 10%."
              [checked]="s().background.batteryAlerts"
              (toggled)="setBackground({ batteryAlerts: $event })"
            ></app-switch-row>
          </div>
        </section>
        }

        @if (current()?.id === 'obiettivi') {
        <section aria-labelledby="obiettivi">
          <h2 id="obiettivi" class="section-title sr-only">Obiettivi</h2>
          <div class="card">
            <label class="field">
              <span class="field-label">Ore di sonno</span>
              <select (change)="setSleepGoal($any($event.target).value)">
                @for (minutes of sleepGoals; track minutes) {
                  <option [value]="minutes" [selected]="minutes === s().sleepGoalMin">{{ formatGoal(minutes) }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span class="field-label">A letto entro</span>
              <input type="time" [value]="s().bedtime" (change)="setTime('bedtime', $any($event.target))" />
            </label>
            <label class="field">
              <span class="field-label">Risveglio abituale</span>
              <input type="time" [value]="s().wakeTime" (change)="setTime('wakeTime', $any($event.target))" />
            </label>
            <label class="field">
              <span class="field-label">Passi al giorno</span>
              <input
                type="number"
                inputmode="numeric"
                [attr.min]="stepsMin"
                [attr.max]="stepsMax"
                step="500"
                [value]="s().stepsGoal"
                (change)="setSteps($any($event.target))"
              />
            </label>
            <p class="hint">Passi: da {{ formatSteps(stepsMin) }} a {{ formatSteps(stepsMax) }}.</p>
          </div>
        </section>
        }

        @if (current()?.id === 'abitudini') {
        <section aria-labelledby="abitudini">
          <h2 id="abitudini" class="section-title sr-only">Abitudini</h2>
          <div class="card">
            <p class="field-label">Caffeina abituale</p>
            <p class="hint">
              Quello che bevi ogni giorno alla stessa ora. Il Diario lo segna da solo, senza un tocco, e conta per il
              plugin Emicrania come una voce registrata. Il giorno che salti, toglilo dal Diario.
            </p>
            @for (habit of s().habitualCaffeine; track habit.id) {
              <div class="field habit">
                <span class="field-label">{{ habitText(habit) }}</span>
                <button type="button" class="button habit-remove" [attr.aria-label]="removeHabitLabel(habit)" (click)="removeHabit(habit.id)">
                  Togli
                </button>
              </div>
            }
            @if (s().habitualCaffeine.length < maxHabits) {
              <p class="field-label">Aggiungi un'abitudine</p>
              <app-chip-group
                variant="segment"
                label="Bevanda"
                [options]="caffeineOptions"
                [selected]="[habitDrink()]"
                (changed)="setHabitDrink($event)"
              ></app-chip-group>
              <label class="field">
                <span class="field-label">Ogni giorno alle</span>
                <input type="time" [value]="habitTime()" (change)="setHabitTime($any($event.target))" />
              </label>
              <button type="button" class="button" (click)="addHabit()">Aggiungi</button>
            }
          </div>
        </section>
        }

        @if (current()?.id === 'profilo') {
        <section aria-labelledby="profilo">
          <h2 id="profilo" class="section-title sr-only">Profilo</h2>
          <div class="card">
            <p class="hint">
              Servono a stimare le calorie giornaliere. Restano sul tuo telefono e non lasciano mai il tuo server di casa.
            </p>
            <p class="field-label">Sesso</p>
            <app-chip-group
              variant="segment"
              label="Sesso"
              [options]="sexOptions"
              [selected]="[s().profile.sex]"
              (changed)="setSex($event)"
            ></app-chip-group>
            <p class="hint">Serve alla formula del metabolismo. Se non lo indichi si usa la media tra le due.</p>
            <label class="field">
              <span class="field-label">Anno di nascita</span>
              <input
                type="number"
                inputmode="numeric"
                [attr.min]="birthMin"
                [attr.max]="birthMax"
                [value]="s().profile.birthYear ?? ''"
                (change)="setProfileNumber('birthYear', $any($event.target))"
              />
            </label>
            <label class="field">
              <span class="field-label">Altezza (cm)</span>
              <input
                type="number"
                inputmode="numeric"
                [attr.min]="heightMin"
                [attr.max]="heightMax"
                [value]="s().profile.heightCm ?? ''"
                (change)="setProfileNumber('heightCm', $any($event.target))"
              />
            </label>
            <label class="field">
              <span class="field-label">Peso (kg)</span>
              <input
                type="number"
                inputmode="decimal"
                step="0.5"
                [attr.min]="weightMin"
                [attr.max]="weightMax"
                [value]="s().profile.weightKg ?? ''"
                (change)="setProfileNumber('weightKg', $any($event.target))"
              />
            </label>
            <p class="hint">
              Un campo vuoto o fuori scala non viene salvato: senza anno, altezza e peso le calorie non si stimano.
            </p>
          </div>
        </section>
        }

        @if (current()?.id === 'plugin') {
        <section aria-labelledby="plugin">
          <h2 id="plugin" class="section-title sr-only">Plugin</h2>
          <div class="card">
            @for (id of pluginIds; track id) {
              <app-switch-row
                [label]="pluginInfo[id].name"
                [description]="pluginInfo[id].description"
                [checked]="s().plugins[id]"
                (toggled)="setPlugin(id, $event)"
              ></app-switch-row>
              <a class="plugin-guide" [routerLink]="['/guida', pluginGuide[id]]">Come funziona {{ pluginInfo[id].name }}</a>
              @if (configurable(id); as view) {
                <app-plugin-config [plugin]="view"></app-plugin-config>
              }
            }
            <p class="hint">Le card dei plugin compaiono in Oggi quando il telefono è collegato al server.</p>
          </div>
        </section>
        }

        @if (current()?.id === 'notifiche') {
        <section aria-labelledby="notifiche">
          <h2 id="notifiche" class="section-title sr-only">Notifiche</h2>
          <app-alerts-settings></app-alerts-settings>
        </section>
        }

        @if (current()?.id === 'server') {
        <section aria-labelledby="server">
          <h2 id="server" class="section-title sr-only">Server di casa</h2>
          <div class="card">
            <label class="field">
              <span class="field-label">Indirizzo</span>
              <input
                type="url"
                inputmode="url"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                placeholder="https://"
                [value]="s().serverUrl"
                [attr.aria-describedby]="serverError() ? 'server-error' : null"
                [attr.aria-invalid]="serverError() ? 'true' : null"
                (change)="setServer($any($event.target))"
              />
            </label>
            @if (serverError()) {
              <p id="server-error" class="error" role="alert">Inserisci un indirizzo che inizia con https:// o http://.</p>
            }
            <label class="field">
              <span class="field-label">Indirizzo sulla rete di casa (facoltativo)</span>
              <input
                type="url"
                inputmode="url"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                placeholder="http://192.168.1.20:8080"
                [value]="s().homeUrl"
                [attr.aria-describedby]="homeError() ? 'home-error' : 'home-hint'"
                [attr.aria-invalid]="homeError() ? 'true' : null"
                (change)="setHome($any($event.target))"
              />
            </label>
            @if (homeError()) {
              <p id="home-error" class="error" role="alert">
                Inserisci l'indirizzo di un dispositivo della rete di casa, per esempio 192.168.1.20:8080. Altri indirizzi non
                sono accettati.
              </p>
            }
            <p id="home-hint" class="hint">
              Serve per usare il server dal Wi-Fi di casa senza tenere Tailscale attivo. L'app prova prima l'indirizzo
              sicuro e usa questo solo se il primo non risponde. Sulla rete di casa i dati viaggiano senza cifratura: lascialo
              vuoto se non vuoi questo compromesso.
            </p>
            <p class="hint server-status" role="status">{{ serverStatusText() }}</p>
            <button
              type="button"
              class="button"
              [disabled]="s().serverUrl === '' || serverStatus() === 'checking'"
              (click)="checkServer()"
            >
              Verifica
            </button>
            @if (s().serverUrl !== '') {
              <p class="hint">Identificativo di questo telefono: <code>{{ credentials.hardwareId() }}</code></p>
              @if (paired()) {
                <p class="paired">Questo telefono è collegato al server.</p>
                <button type="button" class="button" [disabled]="demoState() === 'sending'" (click)="uploadDemo()">
                  Carica dati di prova
                </button>
                <p class="hint">
                  Invia 10 giorni di dati inventati (sonno, battito, passi) per vedere gli indici calcolati dal server.
                  Usali solo con un server di prova: restano nel database insieme ai dati veri.
                </p>
                @if (demoMessage(); as message) {
                  <p class="hint" role="status">{{ message }}</p>
                }
                <button type="button" class="button" [disabled]="diarySync.restoring()" (click)="restoreDiary()">
                  Ripristina il diario dal server
                </button>
                @if (restoreMessage(); as message) {
                  <p class="hint" role="status">{{ message }}</p>
                }
                <p class="hint">
                  Annota l'identificativo: su un telefono nuovo serve a ritrovare qui i tuoi dati, diario compreso.
                </p>
                <button type="button" class="button" (click)="unpair()">Scollega</button>
                <p class="hint">
                  Scollegare cancella il collegamento solo su questo telefono. Per togliere l'accesso sul server,
                  collega di nuovo il telefono: il vecchio accesso smette di funzionare.
                </p>
              } @else {
                <label class="field">
                  <span class="field-label">Ripristina un telefono precedente</span>
                  <input
                    #previous
                    type="text"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    placeholder="phone-…"
                    [attr.aria-describedby]="idError() ? 'id-error' : null"
                    [attr.aria-invalid]="idError() ? 'true' : null"
                  />
                </label>
                @if (idError()) {
                  <p id="id-error" class="error" role="alert">Identificativo non valido: servono 8-80 caratteri tra lettere, cifre, punto, trattino.</p>
                }
                <button type="button" class="button" (click)="useId(previous)">Usa questo identificativo</button>
                <label class="field">
                  <span class="field-label">Segreto di registrazione</span>
                  <input
                    #secret
                    type="password"
                    autocomplete="off"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    [attr.aria-describedby]="pairError() ? 'pair-error' : null"
                    [attr.aria-invalid]="pairError() ? 'true' : null"
                  />
                </label>
                <p class="hint">Lo trovi nelle opzioni dell'app RingLife in Home Assistant. Non viene salvato.</p>
                @if (pairError()) {
                  <p id="pair-error" class="error" role="alert">{{ pairError() }}</p>
                }
                <button type="button" class="button" [disabled]="pairing()" (click)="pair(secret)">
                  Collega questo telefono
                </button>
              }
            }
            <p class="hint" role="status">{{ diarySyncText() }}</p>
            @if (paired()) {
              <button type="button" class="button" [disabled]="diarySync.syncing() || diarySync.pending() === 0" (click)="sendDiary()">
                Invia il diario
              </button>
            }
          </div>
                  <a class="menu-link" routerLink="/benvenuto" aria-describedby="rifai-hint">
            <span class="menu-title">Rifai la configurazione guidata</span>
          </a>
          <p id="rifai-hint" class="hint">Server, anello, profilo e prima lettura, un passo alla volta. Non cancella niente.</p>
        </section>
        }

        @if (current()?.id === 'aspetto') {
        <section aria-labelledby="aspetto">
          <h2 id="aspetto" class="section-title sr-only">Aspetto</h2>
          <div class="card">
            <p class="field-label">Tema</p>
            <app-chip-group
              variant="segment"
              label="Tema"
              [options]="themeOptions"
              [selected]="[s().theme]"
              (changed)="setTheme($event)"
            ></app-chip-group>
            <app-switch-row
              label="Penombra durante un episodio"
              description="Toni più spenti, niente animazioni."
              [checked]="s().penombra"
              (toggled)="setPenombra($event)"
            ></app-switch-row>
          </div>
        </section>
        }

        @if (!current()) {
          <div class="brand-header">
            <app-logo [size]="40" [wordmark]="true"></app-logo>
            <p class="hint">Il tuo anello, a casa tua: i dati restano sul server di casa.</p>
          </div>
          <p class="footer">RingLife {{ version }} · non è un dispositivo medico</p>
        }
      </main>
    </ion-content>
  `,
})
export class SettingsPage {
  private readonly service = inject(SettingsService);
  private readonly api = inject(RingLifeApi);
  private readonly plugins = inject(PluginsService);
  private readonly oggiData = inject(OggiDataService);
  protected readonly diarySync = inject(DiarySyncService);
  protected readonly credentials = inject(CredentialsService);

  /** La sezione aperta, dall'indirizzo `/impostazioni/<sezione>`. Senza, si vede l'elenco. */
  readonly section = input<string | undefined>(undefined);
  private readonly alerts = inject(AlertsService);
  private readonly backgroundBridge = inject(BackgroundBridge);
  /** Il riepilogo di Notifiche nell'elenco: quanti avvisi accesi e le ore silenziose (docs/adr/0045). */
  private alertsSummary(): string {
    const config = this.alerts.config();
    if (!config) {
      return 'Avvisi: da scegliere con il server collegato';
    }
    const on = config.rules.filter((r) => r.enabled).length;
    return `${on} avvisi accesi · silenzio ${config.settings.quietStart}-${config.settings.quietEnd}`;
  }

  /** La pagina della Guida di ogni plugin, sotto il suo interruttore. */
  protected readonly pluginGuide = PLUGIN_GUIDE;
  protected readonly current = computed(() => SETTINGS_SECTIONS.find((item) => item.id === this.section()) ?? null);

  protected readonly s = this.service.settings;
  protected readonly serverError = signal(false);
  protected readonly homeError = signal(false);
  protected readonly serverRoute = signal<Route | null>(null);
  protected readonly serverStatus = signal<'unknown' | 'checking' | 'up' | 'down'>('unknown');
  protected readonly pairing = signal(false);
  protected readonly pairError = signal<string | null>(null);
  protected readonly paired = this.credentials.paired;
  protected readonly idError = signal(false);
  protected readonly restoreMessage = signal<string | null>(null);
  protected readonly demoState = signal<'idle' | 'sending'>('idle');
  protected readonly demoMessage = signal<string | null>(null);

  /** Una riga di riepilogo per sezione, nell'elenco: si vede lo stato senza aprirla. */
  protected readonly menu = computed(() => {
    const settings = this.s();
    const profile = settings.profile;
    const enabled = PLUGIN_IDS.filter((id) => settings.plugins[id]).length;
    const theme = THEME_OPTIONS.find((option) => option.code === settings.theme)?.label ?? '';
    const summaries: Record<SettingsSectionId, string> = {
      anello:
        this.devices.linked() || settings.demoRing
          ? `Batteria ${this.battery()}%${this.ringSync.charging() ? ', in carica' : ''} · ${this.syncText()}`
          : 'Scollegato da RingLife',
      obiettivi: `${formatHoursMinutes(settings.sleepGoalMin)} di sonno · ${formatThousands(settings.stepsGoal)} passi`,
      abitudini:
        settings.habitualCaffeine.length === 0
          ? 'Nessuna caffeina abituale'
          : settings.habitualCaffeine.map((h) => habitText(h)).join(' · '),
      profilo:
        profile.birthYear !== null && profile.heightCm !== null && profile.weightKg !== null
          ? 'Compilato: servono alle calorie'
          : 'Da compilare per stimare le calorie',
      plugin: `${enabled} accesi su ${PLUGIN_IDS.length}`,
      notifiche: this.alertsSummary(),
      server: this.paired() ? 'Telefono collegato' : settings.serverUrl === '' ? 'Non configurato' : 'Indirizzo salvato',
      aspetto: `Tema: ${theme}`,
    };
    return SETTINGS_SECTIONS.map((item) => ({ ...item, summary: summaries[item.id] }));
  });

  protected readonly serverStatusText = computed(() => {
    if (this.s().serverUrl === '') {
      return 'Non configurato.';
    }
    switch (this.serverStatus()) {
      case 'checking':
        return 'Verifica in corso…';
      case 'up':
        return this.serverRoute() === 'home'
          ? 'Raggiungibile sulla rete di casa, senza cifratura.'
          : 'Raggiungibile.';
      case 'down':
        return describeApiError('offline');
      default:
        return 'Indirizzo salvato. Non ancora verificato.';
    }
  });

  protected readonly diarySyncText = computed(() => {
    if (!this.paired()) {
      return 'Il diario resta sul telefono finché non colleghi un server.';
    }
    const error = this.diarySync.error();
    if (error) {
      return `Diario: invio non riuscito. ${describeApiError(error.kind)}`;
    }
    const pending = this.diarySync.pending();
    if (this.diarySync.syncing()) {
      return 'Diario: invio in corso…';
    }
    return pending === 0 ? 'Diario: tutto inviato.' : `Diario: ${pending} ${pending === 1 ? 'elemento' : 'elementi'} da inviare.`;
  });

  protected readonly ringSync = inject(RingSyncService);
  protected readonly devices = inject(RingDeviceService);
  /** La versione del firmware: dalla scheda dell'anello, o dall'ultima lettura se la scheda non c'è ancora. */
  protected readonly firmware = computed(() => firmwareLabel(this.devices.device()?.firmware ?? this.ringSync.last()?.firmware ?? null));
  /** Il controllo del firmware, a ogni lettura, rispetto alla versione su cui RingLife è stato provato (docs/adr/0030). */
  protected readonly firmwareText = computed(() => {
    const device = this.devices.device();
    const note = device ? firmwareNote(device, Date.now()) : null;
    const base = device?.firmware
      ? "Si controlla a ogni lettura dell'anello."
      : "Si legge dall'anello alla prossima lettura.";
    return `${note ? `${note} ` : ''}${base} RingLife non aggiorna il firmware: un aggiornamento può cambiare i formati dei dati che legge.`;
  });
  protected readonly wearChangedText = computed(() => {
    const at = this.s().wear.changedAt;
    return at !== null && Date.now() - at < WEAR_NOTICE_MS ? `Cambiato il ${WEAR_DAY.format(new Date(at))}.` : null;
  });
  protected readonly battery = computed(() => this.ringSync.last()?.battery ?? OGGI_SAMPLE.batteryPercent);
  protected readonly syncText = computed(() => {
    const last = this.ringSync.last();
    return last ? syncedText(last.at, new Date()) : OGGI_SAMPLE.syncText;
  });
  /** Cosa sta succedendo o cosa è andato storto nel sync, in una frase. */
  protected readonly ringSyncText = computed(() => {
    if (this.ringSync.syncing()) {
      return this.ringSync.step() === 'ring' ? "Leggo l'anello…" : 'Invio i dati al server…';
    }
    const ringError = this.ringSync.ringError();
    if (ringError) {
      return ringError;
    }
    const uploadError = this.ringSync.uploadError();
    if (uploadError) {
      return `Invio al server non riuscito. ${describeApiError(uploadError.kind)}`;
    }
    const pending = this.ringSync.pending();
    if (pending > 0) {
      return this.ringSync.serverConnected()
        ? `${pending} ${pending === 1 ? 'dato' : 'dati'} da inviare al server.`
        : `${pending} ${pending === 1 ? 'dato' : 'dati'} sul telefono: si inviano quando colleghi un server.`;
    }
    if (this.ringSync.hasRing()) {
      return 'Tutto aggiornato.';
    }
    return this.devices.linked() ? "La sincronizzazione arriva con il collegamento all'anello." : 'Anello scollegato da RingLife.';
  });

  /** Avvisi che non fermano il sync ma vanno detti: misure non scritte sull'anello, valori impossibili scartati. */
  protected readonly ringWarnings = computed(() => {
    const warnings: string[] = [];
    const settingsError = this.ringSync.settingsError();
    if (settingsError) {
      warnings.push(`Le misure scelte non sono state scritte sull'anello. ${settingsError}`);
    }
    const discarded = this.ringSync.discarded();
    if (discarded > 0) {
      warnings.push(
        `${discarded} ${discarded === 1 ? 'valore scartato' : 'valori scartati'} perché impossibile (per esempio un battito di 255): se succede spesso, la lettura dell'anello ha un errore.`,
      );
    }
    return warnings;
  });
  protected readonly version = APP_VERSION;
  protected readonly hrIntervals = HR_INTERVALS;
  protected readonly backgroundIntervals = BACKGROUND_INTERVALS;
  /** Gli ultimi 5 tentativi in background, riusciti o no, in parole. */
  protected readonly backgroundAttempts = computed(() =>
    this.ringSync.backgroundAttempts().slice(0, 5).map((attempt) => describeAttempt(attempt, new Date())),
  );
  protected readonly lastBackgroundText = computed(() => {
    const at = this.ringSync.lastBackground();
    return at === null ? null : `Ultima lettura in background: ${syncedText(at, new Date()).toLowerCase()}.`;
  });
  protected readonly sleepGoals = SLEEP_GOALS;
  protected readonly stepsMin = STEPS_GOAL_MIN;
  protected readonly stepsMax = STEPS_GOAL_MAX;
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly sexOptions = SEX_OPTIONS;
  private readonly habits = inject(HabitualCaffeineService);
  protected readonly caffeineOptions = CAFFEINE_OPTIONS;
  protected readonly maxHabits = MAX_HABITS;
  protected readonly habitText = habitText;
  /** La bevanda e l'ora della prossima abitudine, prima di «Aggiungi». */
  protected readonly habitDrink = signal<CaffeineDrink>('coffee');
  protected readonly habitTime = signal('08:00');
  protected readonly handOptions = HAND_OPTIONS;
  protected readonly fingerOptions = FINGER_OPTIONS;
  protected readonly birthMin = BIRTH_YEAR_MIN;
  protected readonly birthMax = BIRTH_YEAR_MAX;
  protected readonly heightMin = HEIGHT_MIN_CM;
  protected readonly heightMax = HEIGHT_MAX_CM;
  protected readonly weightMin = WEIGHT_MIN_KG;
  protected readonly weightMax = WEIGHT_MAX_KG;
  protected readonly pluginIds = PLUGIN_IDS;
  protected readonly pluginInfo = PLUGIN_INFO;

  constructor() {
    // I parametri dei plugin vengono dal server: si leggono aprendo le Impostazioni, non solo da Oggi.
    void this.plugins.refresh();
    // Il registro delle letture in background cambia anche ad app aperta (un'automazione di Comandi).
    void this.ringSync.loadBackgroundAttempts();
  }


  protected formatGoal(minutes: number): string {
    return formatHoursMinutes(minutes);
  }

  protected formatSteps(value: number): string {
    return formatThousands(value);
  }

  protected syncNow(): void {
    void this.ringSync.sync();
  }

  protected setDemoRing(on: boolean): void {
    void this.service.update({ demoRing: on });
  }

  protected backgroundLabel(minutes: number): string {
    if (minutes === 0) {
      return 'Spenta';
    }
    return minutes < 60 ? `Al massimo ogni ${minutes} minuti` : `Al massimo ogni ${minutes / 60} ${minutes === 60 ? 'ora' : 'ore'}`;
  }

  /** Misure che l'anello aveva perso e che l'ultima lettura ha riacceso (docs/adr/0049). */
  protected readonly measuresRestoredText = computed(() => {
    const restored = this.ringSync.measuresRestored();
    if (!restored) {
      return null;
    }
    const when = syncedText(restored.at, new Date()).replace(/^Sincronizzato /, '');
    return `L'anello aveva spento: ${restored.names.join(', ')}. RingLife ha riacceso tutto ${when}.`;
  });

  /** Apre Comandi per creare le automazioni (docs/adr/0048). */
  protected openShortcuts(): void {
    void this.backgroundBridge.openShortcuts();
  }

  protected setBackground(patch: Partial<{ intervalMin: number; batteryAlerts: boolean }>): void {
    void this.service.update({ background: { ...this.s().background, ...patch } });
  }

  protected setInterval(value: string): void {
    void this.service.updateRing({ hrIntervalMin: Number(value) });
  }

  protected setRing(patch: { stress?: boolean; spo2?: boolean; hrv?: boolean; temperature?: boolean }): void {
    void this.service.updateRing(patch);
  }

  protected setSleepGoal(value: string): void {
    void this.service.update({ sleepGoalMin: Number(value) });
  }

  protected setTime(field: 'bedtime' | 'wakeTime', input: HTMLInputElement): void {
    if (isValidTime(input.value)) {
      void this.service.update({ [field]: input.value });
    } else {
      // Campo svuotato: torna all'ultimo orario valido.
      input.value = this.s()[field];
    }
  }

  protected setSteps(input: HTMLInputElement): void {
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value)) {
      input.value = String(this.s().stepsGoal);
      return;
    }
    void this.service.update({ stepsGoal: value }).then(() => (input.value = String(this.s().stepsGoal)));
  }

  protected setWear(field: 'hand' | 'finger', codes: string[]): void {
    // Scelta singola: un secondo tocco sulla voce attiva non cambia niente.
    if (codes.length > 0) {
      const patch = field === 'hand' ? { hand: codes[0] as WearHand } : { finger: codes[0] as WearFinger };
      void this.service.updateWear(patch, Date.now());
    }
  }

  protected setHabitDrink(codes: string[]): void {
    const code = codes[0];
    if (code === 'coffee' || code === 'tea' || code === 'energy' || code === 'other') {
      this.habitDrink.set(code);
    }
  }

  protected setHabitTime(input: HTMLInputElement): void {
    if (isValidTime(input.value)) {
      this.habitTime.set(input.value);
    } else {
      input.value = this.habitTime();
    }
  }

  /** Nuova caffeina abituale (docs/adr/0036): da oggi il Diario la segna da solo. */
  protected addHabit(): Promise<void> {
    return this.habits.add(this.habitDrink(), this.habitTime());
  }

  protected removeHabitLabel(habit: HabitualCaffeine): string {
    return `Togli l'abitudine: ${habitText(habit)}`;
  }

  protected removeHabit(id: string): Promise<void> {
    return this.habits.remove(id);
  }

  protected setSex(codes: string[]): void {
    // Gruppo a scelta singola: un secondo tocco sulla voce attiva non cambia nulla.
    if (codes.length > 0) {
      void this.service.updateProfile({ sex: codes[0] as Sex });
    }
  }

  /** Campo del profilo: vuoto cancella il valore; fuori scala non cambia niente e la scheda torna all'ultimo valore. */
  protected setProfileNumber(field: ProfileNumberField, input: HTMLInputElement): void {
    const text = input.value.trim();
    const current = this.s().profile[field];
    if (text === '') {
      void this.service.updateProfile({ [field]: null });
      return;
    }
    const value = Number(text);
    const [min, max] = PROFILE_LIMITS[field];
    if (!Number.isFinite(value) || value < min || value > max) {
      input.value = current === null ? '' : String(current);
      return;
    }
    void this.service.updateProfile({ [field]: value }).then(() => {
      const saved = this.s().profile[field];
      input.value = saved === null ? '' : String(saved);
    });
  }

  /** Il plugin con parametri da mostrare: acceso su questo telefono e sul server, e con almeno un parametro. */
  protected configurable(id: PluginId) {
    return this.s().plugins[id]
      ? this.plugins.views().find((v) => v.manifest.id === id && v.enabled && v.manifest.config.length > 0)
      : undefined;
  }

  protected setPlugin(id: PluginId, enabled: boolean): void {
    void this.service.setPlugin(id, enabled).then(() => this.plugins.pushEnabled(id, enabled));
  }

  protected setServer(input: HTMLInputElement): void {
    const typed = input.value.trim();
    const normalized = normalizeServerUrl(typed);
    // Un indirizzo non valido non si salva e non cancella quello buono: resta l'avviso.
    if (typed !== '' && normalized === '') {
      this.serverError.set(true);
      return;
    }
    this.serverError.set(false);
    if (normalized !== this.s().serverUrl) {
      // L'accesso appartiene al server per cui e' stato rilasciato: un altro indirizzo parte da zero.
      void this.credentials.forget();
      this.serverStatus.set('unknown');
      this.pairError.set(null);
    }
    void this.service.update({ serverUrl: normalized });
    input.value = normalized;
  }

  protected setHome(input: HTMLInputElement): void {
    const typed = input.value.trim();
    // Chi scrive solo «192.168.1.20:8080» intende l'indirizzo di casa: il prefisso si aggiunge da sé.
    const withScheme = typed !== '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? `http://${typed}` : typed;
    const normalized = normalizeHomeUrl(withScheme);
    // Un indirizzo non valido non si salva e non cancella quello buono: resta l'avviso.
    if (typed !== '' && normalized === '') {
      this.homeError.set(true);
      return;
    }
    this.homeError.set(false);
    this.serverStatus.set('unknown');
    void this.service.update({ homeUrl: normalized });
    input.value = normalized;
  }

  protected async checkServer(): Promise<void> {
    this.serverStatus.set('checking');
    const route = await this.api.healthRoute();
    this.serverRoute.set(route);
    this.serverStatus.set(route !== null ? 'up' : 'down');
  }

  protected async pair(secret: HTMLInputElement): Promise<void> {
    const value = secret.value;
    if (value.trim() === '') {
      this.pairError.set('Inserisci il segreto di registrazione.');
      return;
    }
    this.pairing.set(true);
    this.pairError.set(null);
    try {
      await this.api.register(value);
      secret.value = '';
      this.serverStatus.set('up');
      // Un telefono senza diario che si collega a un dispositivo già noto al server ritrova il suo diario.
      if (this.diarySync.isBlank()) {
        const added = await this.diarySync.restore();
        if (added > 0) {
          this.restoreMessage.set(this.restoredText(added));
        }
      }
    } catch (error) {
      const kind = error instanceof ApiError ? error.kind : toApiError(error).kind;
      this.pairError.set(describeApiError(kind));
    } finally {
      this.pairing.set(false);
    }
  }

  /** Carica i dati inventati e poi rilegge Oggi: prova il percorso intero senza l'anello. */
  protected async uploadDemo(): Promise<void> {
    this.demoState.set('sending');
    this.demoMessage.set(null);
    try {
      const now = new Date();
      const offset = tzOffsetMin(now);
      const { samples, sessions } = buildDemoData(now, offset);
      const sleep = await this.api.uploadSleep(sessions, offset);
      const data = await this.api.uploadSamples(samples, offset);
      await this.oggiData.refresh(now);
      this.demoMessage.set(
        `Caricati ${data.inserted} campioni e ${sleep.inserted} notti nuovi (già presenti: ${data.duplicates + sleep.duplicates}).`,
      );
    } catch (error) {
      const kind = error instanceof ApiError ? error.kind : toApiError(error).kind;
      this.demoMessage.set(describeApiError(kind));
    } finally {
      this.demoState.set('idle');
    }
  }

  protected async useId(input: HTMLInputElement): Promise<void> {
    const ok = await this.credentials.useHardwareId(input.value);
    this.idError.set(!ok && input.value.trim() !== '');
    if (ok) {
      input.value = '';
    }
  }

  protected async restoreDiary(): Promise<void> {
    this.restoreMessage.set(null);
    const added = await this.diarySync.restore();
    const error = this.diarySync.error();
    this.restoreMessage.set(
      error
        ? `Ripristino non riuscito. ${describeApiError(error.kind)}`
        : added === 0
          ? 'Il telefono ha già tutto il diario del server.'
          : this.restoredText(added),
    );
  }

  private restoredText(added: number): string {
    return `Riportati ${added} ${added === 1 ? 'elemento' : 'elementi'} del diario.`;
  }

  protected sendDiary(): void {
    void this.diarySync.sync();
  }

  protected unpair(): void {
    void this.credentials.forget();
  }

  protected setTheme(codes: string[]): void {
    // Gruppo a scelta singola: un secondo tocco sulla voce attiva non deve lasciare l'app senza tema.
    if (codes.length > 0) {
      void this.service.update({ theme: codes[0] as ThemeChoice });
    }
  }

  protected setPenombra(enabled: boolean): void {
    void this.service.update({ penombra: enabled });
  }
}
