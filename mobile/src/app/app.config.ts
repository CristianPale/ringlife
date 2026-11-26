import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { CredentialsRepository, SplitCredentialsRepository } from './api/credentials.repository';
import { PLAIN_STORE, PreferencesStore, SECRET_STORE, SecureStore } from './api/key-value-store';
import { CredentialsService } from './api/credentials.service';
import { routes } from './app.routes';
import { HeadacheRepository, PreferencesHeadacheRepository } from './diary/headache.repository';
import { Clock, SystemClock } from './diary/clock';
import { HeadacheService } from './diary/headache.service';
import { JournalRepository, PreferencesJournalRepository } from './diary/journal.repository';
import { JournalService } from './diary/journal.service';
import { PreferencesSettingsRepository, SettingsRepository } from './settings/settings.repository';
import { DiarySyncRepository, PreferencesDiarySyncRepository } from './diary/diary-sync.repository';
import { PreferencesRingQueueRepository, RingQueueRepository } from './ring/ring-queue.repository';
import { PreferencesRingDeviceRepository, RingDeviceRepository } from './ring/ring-device.repository';
import { RingDeviceService } from './ring/ring-device.service';
import { TemperatureLogService } from './ring/temperature-log.service';
import { ManualMeasureLogService } from './ring/manual-measure-log.service';
import { HeartRateLogService } from './ring/heart-rate-log.service';
import { HabitualCaffeineService } from './diary/habitual-caffeine.service';
import { RingSyncService } from './ring/ring-sync.service';
import { DiarySyncService } from './diary/diary-sync.service';
import { SettingsService } from './settings/settings.service';
import { SessionHistoryService } from './session/session-history.service';
import { StepsLogService } from './ring/steps-log.service';
import { PushService } from './avvisi/push.service';
import { DaysService } from './api/days.service';
import { PluginsService } from './plugins/plugins.service';
import { AlertsService } from './avvisi/alerts.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideIonicAngular(),
    provideHttpClient(withFetch()),
    // Hash routing: funziona sia con capacitor://localhost sia sotto HA Ingress,
    // dove il path base e' variabile.
    // Il parametro `:section` di Impostazioni arriva come input del componente.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    { provide: HeadacheRepository, useClass: PreferencesHeadacheRepository },
    { provide: JournalRepository, useClass: PreferencesJournalRepository },
    { provide: SettingsRepository, useClass: PreferencesSettingsRepository },
    { provide: PLAIN_STORE, useValue: new PreferencesStore() },
    { provide: SECRET_STORE, useValue: new SecureStore() },
    { provide: CredentialsRepository, useClass: SplitCredentialsRepository },
    { provide: DiarySyncRepository, useClass: PreferencesDiarySyncRepository },
    { provide: RingQueueRepository, useClass: PreferencesRingQueueRepository },
    { provide: RingDeviceRepository, useClass: PreferencesRingDeviceRepository },
    { provide: Clock, useClass: SystemClock },
    // Carica i dati salvati prima della prima schermata: una cefalea aperta cambia Oggi.
    provideAppInitializer(() => {
      const habits = inject(HabitualCaffeineService);
      const days = inject(DaysService);
      const plugins = inject(PluginsService);
      const alerts = inject(AlertsService);
      const push = inject(PushService);
      return Promise.all([
        inject(HeadacheService).init(),
        inject(JournalService).init(),
        inject(SettingsService).init(),
        inject(CredentialsService).init(),
        inject(DiarySyncService).init(),
        inject(RingSyncService).init(),
        inject(RingDeviceService).init(),
        inject(TemperatureLogService).init(),
        inject(ManualMeasureLogService).init(),
        inject(HeartRateLogService).init(),
        inject(StepsLogService).init(),
        inject(SessionHistoryService).init(),
        habits.init(),
      ])
        // La caffeina abituale ha bisogno di diario e impostazioni già caricati (docs/adr/0036). Gli ultimi risultati
        // del server salvati sul telefono hanno bisogno delle credenziali: sono di un dispositivo (docs/adr/0043).
        .then(() => Promise.all([habits.apply(), days.init(), plugins.init(), alerts.init(), push.init()]));
    }),
  ],
};
