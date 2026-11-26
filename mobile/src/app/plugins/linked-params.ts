import { Settings } from '../settings/settings.model';
import { PluginView } from './plugin.model';

/** Un parametro dei plugin che di base viene da Obiettivi (docs/adr/0025). */
export interface LinkedParam {
  /** Dove si cambia per tutti i plugin insieme. */
  source: string;
  value: (settings: Settings) => string | number;
}

/** Per chiave del parametro: la stessa chiave in plugin diversi segue la stessa impostazione. */
export const LINKED_PARAMS: Readonly<Record<string, LinkedParam>> = {
  wakeTime: { source: 'Obiettivi › Risveglio', value: (s) => s.wakeTime },
  bedtime: { source: 'Obiettivi › Coricarsi', value: (s) => s.bedtime },
  sleepGoalHours: { source: 'Obiettivi › Sonno', value: (s) => Math.round(s.sleepGoalMin / 60) },
};

/** Il parametro segue Obiettivi: è collegato e non è stato scelto a mano per questo plugin. */
export function followsSettings(pluginId: string, key: string, settings: Settings): boolean {
  return key in LINKED_PARAMS && !(settings.pluginOverrides[pluginId] ?? []).includes(key);
}

/**
 * La configurazione da mandare perché i parametri collegati del plugin seguano Obiettivi, o `null` se è già allineata.
 * Al server vanno solo i valori diversi dai predefiniti, come per i parametri scelti a mano.
 */
export function alignedConfig(view: PluginView, settings: Settings): Record<string, unknown> | null {
  let changed = false;
  const chosen: Record<string, unknown> = {};
  for (const field of view.manifest.config) {
    const current = field.key in view.config ? view.config[field.key] : field.defaultValue;
    let next = current;
    if (followsSettings(view.manifest.id, field.key, settings)) {
      next = LINKED_PARAMS[field.key].value(settings);
      if (field.type === 'INT' && typeof next === 'number') {
        next = Math.min(field.max ?? next, Math.max(field.min ?? next, next));
      }
      changed ||= next !== current;
    }
    if (next !== field.defaultValue) {
      chosen[field.key] = next;
    }
  }
  return changed ? chosen : null;
}
