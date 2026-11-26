import { Injectable, computed, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Clock, SystemClock } from '../diary/clock';
import { SettingsService } from '../settings/settings.service';
import { CapacitorRingLink } from './ble/capacitor-ring-link';
import { RingChooserService } from './ring-chooser.service';
import { BleRingSource } from './ble/ble-ring-source';
import { DemoRingSource } from './demo-ring-source';
import { RingDeviceService } from './ring-device.service';
import { NoRingSource, RingSource } from './ring-source';

/**
 * Sceglie la sorgente dell'anello (docs/adr/0018): quella di prova se è accesa in Impostazioni, altrimenti il Bluetooth
 * sul telefono, nessuna nel browser. Un anello scollegato da RingLife non si legge (docs/adr/0030).
 */
@Injectable({ providedIn: 'root' })
export class RingSourceProvider {
  private readonly settings = inject(SettingsService);
  private readonly clock = inject(Clock, { optional: true }) ?? new SystemClock();
  private readonly devices = inject(RingDeviceService);
  private readonly chooser = inject(RingChooserService);
  private readonly none = new NoRingSource();
  private readonly unlinked = new NoRingSource('not_linked');
  private demo: DemoRingSource | null = null;
  private ble: BleRingSource | null = null;

  readonly current = computed<RingSource>(() => {
    if (this.settings.settings().demoRing) {
      return (this.demo ??= new DemoRingSource(() => this.clock.now()));
    }
    if (!this.devices.linked()) {
      return this.unlinked;
    }
    if (Capacitor.isNativePlatform()) {
      return (this.ble ??= new BleRingSource(
        new CapacitorRingLink({ choose: (choice) => this.chooser.choose(choice) }),
        () => this.clock.now(),
      ));
    }
    return this.none;
  });
}
