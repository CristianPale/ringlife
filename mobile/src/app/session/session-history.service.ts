import { Injectable, computed, inject, signal } from '@angular/core';
import { KeyValueStore, PLAIN_STORE } from '../api/key-value-store';
import { LiveSample, SessionMode, normalizeSessionMode, sessionStats } from './session.model';
import { Activity, HeartRateRecovery, activityLabel, isActivity } from './training';

/** Una sessione salvata sul telefono (docs/adr/0024): un battito al secondo al massimo. */
export interface StoredSession {
  id: string;
  mode: SessionMode;
  /** Inizio, millisecondi dall'epoca. */
  start: number;
  /** Tempo attivo: le pause non contano. */
  durationMs: number;
  samples: LiveSample[];
  /** Solo Allenamento (docs/adr/0042); assenti nelle sessioni salvate prima. */
  activity?: Activity;
  /** La zona obiettivo scelta, 1-5, o `null` senza obiettivo. */
  targetZone?: number | null;
  /** Kilocalorie stimate, o `null` senza anno di nascita e peso. */
  kcal?: number | null;
  /** Il recupero del battito un minuto dopo la fine, o `null` se saltato. */
  recovery?: HeartRateRecovery | null;
}

/** Quello che l'Allenamento aggiunge alla sessione salvata. */
export type TrainingExtras = Pick<StoredSession, 'activity' | 'targetZone' | 'kcal' | 'recovery'>;

const KEY = 'sessions.v1';
/** Quante sessioni tiene il telefono: le più vecchie si scartano. */
export const MAX_SESSIONS = 50;

/** Un valore al secondo: la media dei battiti arrivati in quel secondo. */
export function perSecond(samples: readonly LiveSample[]): LiveSample[] {
  const buckets = new Map<number, number[]>();
  for (const s of samples) {
    const second = Math.floor(s.t / 1000);
    buckets.set(second, [...(buckets.get(second) ?? []), s.bpm]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([second, values]) => ({ t: second * 1000, bpm: Math.round(values.reduce((a, b) => a + b, 0) / values.length) }));
}

function isStored(value: unknown): value is StoredSession {
  const v = value as Record<string, unknown>;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v['id'] === 'string' &&
    normalizeSessionMode(v['mode']) !== null &&
    typeof v['start'] === 'number' &&
    typeof v['durationMs'] === 'number' &&
    Array.isArray(v['samples'])
  );
}

/**
 * Lo storico delle sessioni di battito dal vivo, solo sul telefono: non va al server (docs/adr/0024). Dal più recente.
 */
@Injectable({ providedIn: 'root' })
export class SessionHistoryService {
  private readonly store = inject<KeyValueStore>(PLAIN_STORE, { optional: true });
  private readonly state = signal<readonly StoredSession[]>([]);

  readonly sessions = this.state.asReadonly();
  readonly lastBreathing = computed(() => this.state().find((s) => s.mode === 'respirazione') ?? null);
  readonly lastTraining = computed(() => this.state().find((s) => s.mode === 'allenamento') ?? null);
  /** Gli allenamenti, dal più recente. */
  readonly trainings = computed(() => this.state().filter((s) => s.mode === 'allenamento'));

  async init(): Promise<void> {
    try {
      const raw = await this.store?.get(KEY);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.state.set(
        Array.isArray(list)
          ? list
              .filter(isStored)
              .map((s) => ({
                ...s,
                mode: normalizeSessionMode(s.mode) as SessionMode,
                activity: isActivity(s.activity) ? s.activity : undefined,
              }))
              .sort((a, b) => b.start - a.start)
          : [],
      );
    } catch {
      this.state.set([]);
    }
  }

  byId(id: string): StoredSession | null {
    return this.state().find((s) => s.id === id) ?? null;
  }

  /** Salva una sessione finita. Senza battiti non c'è niente da tenere. */
  async add(
    mode: SessionMode,
    start: number,
    durationMs: number,
    samples: readonly LiveSample[],
    extras: TrainingExtras = {},
  ): Promise<StoredSession | null> {
    if (samples.length === 0) {
      return null;
    }
    const session: StoredSession = { id: `s${start.toString(36)}`, mode, start, durationMs, samples: perSecond(samples), ...extras };
    const next = [session, ...this.state().filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
    return session;
  }

  async remove(id: string): Promise<void> {
    const next = this.state().filter((s) => s.id !== id);
    this.state.set(next);
    await this.store?.set(KEY, JSON.stringify(next));
  }
}

/** Riepilogo in una riga, per lo storico e per l'anteprima in Oggi. */
export function sessionSummary(session: StoredSession): string {
  const stats = sessionStats(session.samples);
  const minutes = Math.max(1, Math.round(session.durationMs / 60_000));
  if (!stats) {
    return `${minutes} min`;
  }
  if (session.mode === 'respirazione') {
    return `${minutes} min · battito da ${stats.start} a ${stats.end}`;
  }
  const activity = session.activity ? `${activityLabel(session.activity)}, ` : '';
  return `${activity}${minutes} min · media ${stats.avg}, massimo ${stats.max}`;
}

/** «lun 17 nov, 10:20» nel fuso del telefono. */
export function sessionDate(start: number): string {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(start),
  );
}
