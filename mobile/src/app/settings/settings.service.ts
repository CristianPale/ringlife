import { Injectable, inject, signal } from '@angular/core';
import { DEFAULT_SETTINGS, PluginId, Profile, RingSettings, Settings, Wear, normalizeSettings } from './settings.model';
import { SettingsRepository } from './settings.repository';

/** Impostazioni dell'app. Ogni modifica viene controllata e salvata subito. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly repository = inject(SettingsRepository, { optional: true });

  private readonly state = signal<Settings>(DEFAULT_SETTINGS);
  readonly settings = this.state.asReadonly();

  async init(): Promise<void> {
    if (this.repository) {
      this.state.set(await this.repository.load());
    }
  }

  async update(patch: Partial<Omit<Settings, 'ring' | 'plugins' | 'profile' | 'wear'>>): Promise<void> {
    await this.commit({ ...this.state(), ...patch });
  }

  async updateRing(patch: Partial<RingSettings>): Promise<void> {
    await this.commit({ ...this.state(), ring: { ...this.state().ring, ...patch } });
  }

  /** Mano o dito: se cambiano davvero, si ricorda quando (`at`, ms). */
  async updateWear(patch: Partial<Pick<Wear, 'hand' | 'finger'>>, at: number): Promise<void> {
    const current = this.state().wear;
    const next = { ...current, ...patch };
    if (next.hand === current.hand && next.finger === current.finger) {
      return;
    }
    await this.commit({ ...this.state(), wear: { ...next, changedAt: at } });
  }

  async updateProfile(patch: Partial<Profile>): Promise<void> {
    await this.commit({ ...this.state(), profile: { ...this.state().profile, ...patch } });
  }

  /** Segna un parametro di un plugin come scelto a mano (`true`) o di nuovo collegato a Obiettivi (`false`). */
  async setPluginOverride(pluginId: string, key: string, overridden: boolean): Promise<void> {
    const current = this.state().pluginOverrides[pluginId] ?? [];
    const next = overridden ? [...new Set([...current, key])] : current.filter((k) => k !== key);
    await this.commit({ ...this.state(), pluginOverrides: { ...this.state().pluginOverrides, [pluginId]: next } });
  }

  /** Tutti i parametri di un plugin tornano collegati (con «Ripristina i predefiniti»). */
  async clearPluginOverrides(pluginId: string): Promise<void> {
    const { [pluginId]: _removed, ...rest } = this.state().pluginOverrides;
    await this.commit({ ...this.state(), pluginOverrides: rest });
  }

  async setPlugin(id: PluginId, enabled: boolean): Promise<void> {
    await this.commit({ ...this.state(), plugins: { ...this.state().plugins, [id]: enabled } });
  }

  private async commit(next: Settings): Promise<void> {
    // Un valore fuori limite non si salva: `normalizeSettings` lo riporta nei limiti o al predefinito.
    const checked = normalizeSettings(next);
    this.state.set(checked);
    await this.repository?.save(checked);
  }
}
