/**
 * Il registro dei tentativi di lettura in background del raccoglitore nativo, riusciti o no (docs/adr/0026). Serve a
 * capire perché una lettura decisa da iOS o da un'automazione di Comandi non è arrivata.
 */
export interface BackgroundAttempt {
  /** Inizio e fine, ms. */
  at: number;
  end: number;
  /** `background` (iOS) o `shortcut` (Comandi). */
  source: string;
  /** `saved` se riuscita, altrimenti il motivo (`time_limit`, `ring_not_found`…). */
  outcome: string;
  /** Dove si è fermata: `bluetooth`, `connecting`, `services` o la richiesta (`hr:0`…). Vuoto se riuscita. */
  stage: string;
  /** Richieste completate e richieste in tutto. */
  done: number;
  total: number;
  /**
   * Fin dove è arrivata la catena dopo la lettura (docs/adr/0048): `no_page`, `decoded`, `uploaded`, `alerts`,
   * `failed`, `skipped`, `timeout`. Vuoto se non è partita (lettura non riuscita, o registro di prima).
   */
  chain: string;
}

/** Il JSON del nativo, dal più recente. Le righe illeggibili si scartano. */
export function parseBackgroundAttempts(json: string): BackgroundAttempt[] {
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const out: BackgroundAttempt[] = [];
  for (const item of list) {
    const v = item as Record<string, unknown>;
    if (typeof v !== 'object' || v === null || typeof v['at'] !== 'number' || typeof v['outcome'] !== 'string') {
      continue;
    }
    out.push({
      at: v['at'],
      end: typeof v['end'] === 'number' ? v['end'] : v['at'],
      source: typeof v['source'] === 'string' ? v['source'] : 'background',
      outcome: v['outcome'],
      stage: typeof v['stage'] === 'string' ? v['stage'] : '',
      done: typeof v['done'] === 'number' ? v['done'] : 0,
      total: typeof v['total'] === 'number' ? v['total'] : 0,
      chain: typeof v['chain'] === 'string' ? v['chain'] : '',
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

const OUTCOMES: Record<string, string> = {
  saved: 'riuscita',
  time_limit: 'non riuscita: tempo scaduto',
  ring_not_found: "non riuscita: il telefono non trova l'anello",
  connect_failed: 'non riuscita: collegamento non riuscito',
  bluetooth_off: 'non riuscita: Bluetooth spento',
  bluetooth_unauthorized: 'non riuscita: manca il permesso Bluetooth',
  bluetooth_unsupported: 'non riuscita: Bluetooth non disponibile',
  busy: "saltata: un'altra lettura era in corso",
  stale: 'rimasta bloccata, chiusa dalla lettura dopo',
  expired: 'interrotta da iOS: tempo finito',
  app_reading: "interrotta: l'app ha letto l'anello da sé",
  app_active: "saltata: l'app era aperta",
  unlinked: 'saltata: anello scollegato da RingLife',
};

const DAYS = ['oggi', 'ieri'];
const STAGES: Record<string, string> = {
  bluetooth: 'in attesa del Bluetooth',
  connecting: 'durante il collegamento',
  services: 'durante la preparazione',
  time: "all'ora",
  battery: 'alla batteria',
  sleep: 'al sonno',
  spo2: "all'ossigeno nel sangue (SpO2)",
  temp: 'alla temperatura',
};
const DAY_STAGES: Record<string, string> = {
  steps: 'ai passi',
  hr: 'al battito',
  stress: 'allo stress',
  hrv: 'alla variabilità del battito (HRV)',
};

/** «al battito di oggi», «durante il collegamento». Vuoto se non si sa. */
export function stageText(stage: string): string {
  const [kind, day] = stage.split(':');
  if (day !== undefined && DAY_STAGES[kind]) {
    return `${DAY_STAGES[kind]} di ${DAYS[Number(day)] ?? `${day} giorni fa`}`;
  }
  return STAGES[stage] ?? '';
}

const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
const DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/** «oggi alle 14:05», «ieri alle 00:00», «il 16 novembre alle 18:30». */
export function attemptWhen(at: number, now: Date): string {
  const when = new Date(at);
  const time = TIME.format(when);
  const key = DAY_KEY.format(when);
  if (key === DAY_KEY.format(now)) {
    return `oggi alle ${time}`;
  }
  if (key === DAY_KEY.format(new Date(now.getTime() - 86_400_000))) {
    return `ieri alle ${time}`;
  }
  return `il ${DAY.format(when)} alle ${time}`;
}

/** Fin dove è arrivata la catena dopo una lettura riuscita (docs/adr/0048). */
const CHAINS: Record<string, string> = {
  no_page: "dati sul telefono fino all'apertura",
  decoded: 'non inviata: il server di casa non ha risposto',
  uploaded: 'inviata, avvisi non scaricati',
  alerts: 'inviata e avvisi controllati',
  failed: "invio non riuscito, riprova all'apertura",
  skipped: "invio lasciato all'app",
  timeout: 'tempo finito prima di inviare',
};

export function chainText(chain: string): string {
  return CHAINS[chain] ?? '';
}

const SOURCES: Record<string, string> = { shortcut: 'Comandi', night: 'iOS, di notte' };

/** Una riga del registro: quando, chi l'ha chiesta, com'è andata e, se non è riuscita, dove si è fermata. */
export function describeAttempt(attempt: BackgroundAttempt, now: Date): string {
  const who = SOURCES[attempt.source] ?? 'iOS';
  const seconds = Math.max(0, Math.round((attempt.end - attempt.at) / 1000));
  let result = OUTCOMES[attempt.outcome] ?? `non riuscita (${attempt.outcome})`;
  const chain = chainText(attempt.chain);
  if (attempt.outcome === 'saved') {
    result = `riuscita in ${seconds} s${chain ? `, ${chain}` : ''}`;
  } else if (attempt.outcome === 'partial') {
    // Tempo scaduto, ma le richieste già complete sono state tenute (docs/adr/0048, aggiornamento del 26 novembre).
    const where = stageText(attempt.stage);
    result = `in parte: tempo scaduto${where ? ` ${where}` : ''}, tenute ${attempt.done} richieste su ${attempt.total}${chain ? `, ${chain}` : ''}`;
  } else if (attempt.total > 0) {
    const where = stageText(attempt.stage);
    result += `${where ? `, fermata ${where}` : ''}, ${attempt.done} richieste su ${attempt.total}`;
  }
  return `${attemptWhen(attempt.at, now)} · ${who} · ${result}`;
}
