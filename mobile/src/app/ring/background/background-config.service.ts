import { Injectable, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SettingsService } from '../../settings/settings.service';
import { RingDeviceService } from '../ring-device.service';
import { BackgroundBridge, RING_WATCH_HOURS } from './ring-background';

/** «07:00» → 420; -1 se non valido. */
export function minutesOfDay(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

/**
 * Tiene il nativo allineato alle Impostazioni: intervallo della lettura in background e avvisi della batteria
 * (docs/adr/0026). Con l'anello scollegato da RingLife la lettura in background è spenta (docs/adr/0030). Solo sul
 * telefono.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundConfigService {
  private readonly settings = inject(SettingsService);
  private readonly bridge = inject(BackgroundBridge);
  private readonly devices = inject(RingDeviceService);

  constructor() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    effect(() => {
      const settings = this.settings.settings();
      const { intervalMin, batteryAlerts, ringWatch } = settings.background;
      const linked = this.devices.linked();
      const interval = linked ? intervalMin : 0;
      void this.bridge.configure({
        intervalMin: interval,
        batteryAlerts,
        // «Anello non letto» solo con l'anello collegato a RingLife: scollegato apposta, non serve ricordarlo.
        ringWatchHours: linked && ringWatch ? RING_WATCH_HOURS : 0,
        // Il compito notturno segue la lettura in background (docs/adr/0048).
        wakeMin: interval > 0 ? minutesOfDay(settings.wakeTime) : -1,
      });
    });
  }
}
