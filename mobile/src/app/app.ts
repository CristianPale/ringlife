import { Component, effect, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { HeadacheService } from './diary/headache.service';
import { SettingsService } from './settings/settings.service';
import { MigraineReportService } from './reports/migraine-report.service';
import { SyncAlertComponent } from './ring/sync-alert.component';
import { RingChooserComponent } from './ring/ring-chooser.component';
import { ResumeSyncService } from './ring/resume-sync.service';
import { ChargingMonitorService } from './ring/charging-monitor.service';
import { SyncIndicatorComponent } from './ring/sync-indicator.component';
import { StartupLoaderComponent } from './startup/startup-loader.component';
import { StartupSyncService } from './startup/startup-sync.service';
import { BackgroundConfigService } from './ring/background/background-config.service';
import { BackgroundBridge } from './ring/background/ring-background';
import { BackgroundChainService } from './ring/background/background-chain.service';
import { Router } from '@angular/router';

@Component({
  imports: [IonApp, IonRouterOutlet, StartupLoaderComponent, SyncIndicatorComponent, SyncAlertComponent, RingChooserComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private readonly headaches = inject(HeadacheService);
  private readonly settings = inject(SettingsService);

  constructor() {
    // All'apertura: invia il diario che manca e riscarica i dati, con il logo sopra l'app (ADR 0002).
    void inject(StartupSyncService).run();
    // Al ritorno nell'app, se l'ultima sincronizzazione è vecchia di almeno 15 minuti, si rilegge l'anello (ADR 0028).
    inject(ResumeSyncService).listen();
    // Anello in carica: la batteria si rilegge una volta al minuto finché resta sul caricatore (ADR 0029).
    inject(ChargingMonitorService);
    // Lettura in background e avvisi della batteria allineati alle Impostazioni (docs/adr/0026).
    inject(BackgroundConfigService);
    // Dopo una lettura in background: decodifica, invio e avvisi anche senza aprire l'app (docs/adr/0048).
    inject(BackgroundChainService).start();
    // Il tocco su un avviso apre la sua pagina (docs/adr/0045).
    const router = inject(Router);
    inject(BackgroundBridge).onNotificationTap((route) => void router.navigateByUrl(route));
    // Toglie i report PDF rimasti da una condivisione interrotta (docs/adr/0019).
    void inject(MigraineReportService).cleanup();
    // Penombra: palette scura e a basso contrasto finché una cefalea è aperta (ADR 0006).
    // Si disattiva da Impostazioni.
    effect(() =>
      document.body.classList.toggle(
        'penombra',
        this.headaches.active() !== null && this.settings.settings().penombra,
      ),
    );
    // Tema scelto in Impostazioni. «Sistema» non mette nessuna classe: valgono le impostazioni del telefono.
    effect(() => {
      const theme = this.settings.settings().theme;
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
    });
  }
}
