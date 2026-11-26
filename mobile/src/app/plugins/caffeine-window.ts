import { DayRange } from '../livella/giro';
import { PluginView } from './plugin.model';

const DEFAULTS = { wakeTime: '07:00', sleepGoalHours: 8, delayMinutes: 90, cutoffHours: 8 };

function configValue(view: PluginView, key: keyof typeof DEFAULTS): unknown {
  return view.config[key] ?? view.manifest.config.find((field) => field.key === key)?.defaultValue ?? DEFAULTS[key];
}

function minutesOf(value: unknown): number {
  const match = typeof value === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : 7 * 60;
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * La finestra caffeina come arco del giro (ADR 0020). Stessa regola del server (ADR 0016): da risveglio + attesa
 * a coricarsi − ore di stop, con coricarsi = risveglio − obiettivo di sonno. `null` se la finestra è vuota.
 * Il server resta l'autorità sul testo della card: qui si ricalcolano solo gli orari fissi, dai parametri che manda.
 */
export function caffeineWindowOf(view: PluginView): DayRange | null {
  const wake = minutesOf(configValue(view, 'wakeTime'));
  const goal = numberOf(configValue(view, 'sleepGoalHours'), DEFAULTS.sleepGoalHours) * 60;
  const start = wake + numberOf(configValue(view, 'delayMinutes'), DEFAULTS.delayMinutes);
  const bedtime = wake + 24 * 60 - goal;
  const stop = bedtime - numberOf(configValue(view, 'cutoffHours'), DEFAULTS.cutoffHours) * 60;
  return stop <= start ? null : { startMin: start, endMin: stop };
}
