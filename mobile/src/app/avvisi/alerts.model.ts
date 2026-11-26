// Avvisi, fase 1 (docs/adr/0045): il contratto del server e le funzioni pure dell'app.

export type AlertLevel = 'attenzione' | 'alto';
export type AlertSensitivity = 'sensibile' | 'normale' | 'grandi';
export type AlertDelivery = 'notifica' | 'importante' | 'elenco';

export interface AlertSettings {
  /** «22:30»: da qui le notifiche aspettano. */
  quietStart: string;
  /** «07:00»: qui le notifiche ripartono. */
  quietEnd: string;
  /** Testo sulla schermata bloccata: il problema in breve, o generico. */
  lockScreen: 'breve' | 'generico';
  homeAssistant: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  level: AlertLevel;
  /** Confronta con la tua media: tace in calibrazione. */
  usesAverage: boolean;
  params: {
    sensitivity: boolean;
    days: { min: number; max: number } | null;
    threshold: { unit: string; min: number; max: number; step: number } | null;
  };
  enabled: boolean;
  sensitivity: AlertSensitivity | null;
  days: number | null;
  threshold: number | null;
  delivery: AlertDelivery;
}

export interface AlertsConfig {
  settings: AlertSettings;
  rules: AlertRule[];
  /** Avvisi tuoi (docs/adr/0046). Assenti con un server di prima. */
  custom?: CustomRule[];
  metrics?: CustomMetric[];
  maxCustom?: number;
}

/** Confronto di un avviso tuo: con la tua media (in scostamenti) o con un valore nella sua unità. */
export type CustomComparison = 'above_average' | 'below_average' | 'above' | 'below';

/** Una misura che un avviso tuo può guardare (catalogo del server, docs/adr/0046). */
export interface CustomMetric {
  id: string;
  name: string;
  /** `null` per le misure che si confrontano solo con la tua media (temperatura, ossigeno). */
  unit: string | null;
  /** Misura della notte: «notti di fila». Le altre: «giorni di fila». */
  night: boolean;
  /** Si confronta con la tua media. */
  average: boolean;
  /** Intervallo del valore, o `null` se si confronta solo con la tua media. */
  value: { min: number; max: number; step: number } | null;
}

export interface CustomRule {
  id: string;
  name: string;
  metric: string;
  comparison: CustomComparison;
  /** Scostamenti per i confronti con la tua media, il valore nella sua unità per gli altri. */
  amount: number;
  days: number;
  level: AlertLevel;
  delivery: AlertDelivery;
  enabled: boolean;
}

/** Una regola nuova o da cambiare: senza id e nome, che dà il server. */
export type CustomRuleDraft = Omit<CustomRule, 'id' | 'name'>;

export interface AlertEvent {
  id: string;
  rule: string;
  /** Il giorno a cui si riferisce, `2026-11-24`. */
  day: string;
  level: AlertLevel;
  title: string;
  body: string;
  /** La pagina dell'app da aprire. */
  route: string | null;
  createdAt: number;
  /** Prima di quest'ora (ms) non si notifica. */
  deliverAfter: number | null;
  seenAt: number | null;
  /**
   * Push dal server (docs/adr/0047): `pending` o `sent` le consegna il server, `none` e `failed` le notifica il
   * telefono. Assente con un server di prima: vale `none`.
   */
  push?: 'none' | 'pending' | 'sent' | 'failed';
}

/** Una modifica della configurazione: solo i campi presenti cambiano. */
export interface AlertsConfigPatch {
  settings?: Partial<AlertSettings>;
  rules?: Record<
    string,
    Partial<Pick<AlertRule, 'enabled' | 'sensitivity' | 'days' | 'threshold' | 'delivery'>>
  >;
}

export const SENSITIVITY_LABELS: Record<AlertSensitivity, string> = {
  sensibile: 'Sensibile',
  normale: 'Normale',
  grandi: 'Solo grandi scostamenti',
};

export const DELIVERY_LABELS: Record<AlertDelivery, string> = {
  notifica: 'Notifica',
  importante: 'Notifica importante',
  elenco: "Solo nell'elenco",
};

export const COMPARISON_LABELS: Record<CustomComparison, string> = {
  above_average: 'Sopra la tua media',
  below_average: 'Sotto la tua media',
  above: 'Sopra un valore',
  below: 'Sotto un valore',
};

/** Scostamenti dalla tua media che un avviso tuo può chiedere. */
export const CUSTOM_DEVIATIONS = { min: 1, max: 3, step: 0.5 } as const;
export const CUSTOM_DAYS = { min: 1, max: 7 } as const;

export function isAverageComparison(comparison: CustomComparison): boolean {
  return comparison === 'above_average' || comparison === 'below_average';
}

/** I confronti che una misura permette: con la tua media se ce l'ha, con un valore se ha un intervallo. */
export function comparisonsOf(metric: CustomMetric): CustomComparison[] {
  return [
    ...(metric.average ? (['above_average', 'below_average'] as const) : []),
    ...(metric.value ? (['above', 'below'] as const) : []),
  ];
}

/** L'intervallo di `amount` per un confronto: scostamenti, o il valore della misura. */
export function amountRange(
  metric: CustomMetric,
  comparison: CustomComparison,
): { min: number; max: number; step: number } | null {
  return isAverageComparison(comparison) ? CUSTOM_DEVIATIONS : metric.value;
}

/** «3.000», «6,5»: come li scrive il server. */
export function italianNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const [int, dec] = Math.abs(rounded).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${rounded < 0 ? '−' : ''}${grouped}${dec ? `,${dec}` : ''}`;
}

const VALUE_SUFFIX: Record<string, string> = {
  resting_hr: ' battiti al minuto',
  hrv: ' ms',
  sleep_debt: ' ore',
};

/**
 * Il nome di un avviso tuo, come lo scrive il server (docs/adr/0046): l'app lo mostra come anteprima nel costruttore.
 * «Passi sotto 3.000 per 3 giorni di fila», «Battito a riposo sopra la tua media di 1,5 scostamenti».
 */
export function customRuleName(metric: CustomMetric, draft: Pick<CustomRuleDraft, 'comparison' | 'amount' | 'days'>): string {
  const side = draft.comparison === 'above' || draft.comparison === 'above_average' ? 'sopra' : 'sotto';
  const amount = italianNumber(draft.amount);
  const what = isAverageComparison(draft.comparison)
    ? `la tua media di ${amount} ${draft.amount === 1 ? 'scostamento' : 'scostamenti'}`
    : `${amount}${VALUE_SUFFIX[metric.id] ?? ''}`;
  const streak = draft.days > 1 ? ` per ${draft.days} ${metric.night ? 'notti' : 'giorni'} di fila` : '';
  return `${metric.name} ${side} ${what}${streak}`;
}

/** Una regola valida per il catalogo: confronto permesso, quantità e giorni negli intervalli. */
export function validCustomDraft(metric: CustomMetric, draft: CustomRuleDraft): boolean {
  const range = amountRange(metric, draft.comparison);
  return (
    comparisonsOf(metric).includes(draft.comparison) &&
    range !== null &&
    draft.amount >= range.min &&
    draft.amount <= range.max &&
    // Il server vuole un valore sul passo, contato dal minimo: 3.000 passi sì, 3.100 no.
    Math.abs((draft.amount - range.min) / range.step - Math.round((draft.amount - range.min) / range.step)) < 1e-9 &&
    Number.isInteger(draft.days) &&
    draft.days >= CUSTOM_DAYS.min &&
    draft.days <= CUSTOM_DAYS.max
  );
}

/** Una regola nuova per una misura: il primo confronto permesso e un valore a metà dell'intervallo. */
export function defaultCustomDraft(metric: CustomMetric): CustomRuleDraft {
  // Le misure solo a valore partono da «sotto» (passi, ore di sonno, indici bassi): il caso più comune.
  const comparison: CustomComparison = metric.average ? 'above_average' : 'below';
  const range = amountRange(metric, comparison);
  const amount = isAverageComparison(comparison)
    ? 2
    : range
      ? Math.round((range.min + range.max) / 2 / range.step) * range.step
      : 0;
  return {
    metric: metric.id,
    comparison,
    amount,
    days: metric.night ? 2 : 3,
    level: 'attenzione',
    delivery: 'notifica',
    enabled: true,
  };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(text: string): number | null {
  const match = TIME.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Il primo istante, da `at`, fuori dalle ore silenziose (ora del telefono). Le ore silenziose possono passare la
 * mezzanotte (22:30-07:00). Con orari uguali o non validi non ci sono ore silenziose.
 */
export function afterQuietHours(at: Date, quietStart: string, quietEnd: string): Date {
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  if (start === null || end === null || start === end) {
    return at;
  }
  const now = at.getHours() * 60 + at.getMinutes();
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) {
    return at;
  }
  const result = new Date(at);
  result.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (result.getTime() <= at.getTime()) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/** Una notifica da mostrare: subito o all'ora `at`. */
export interface PlannedNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  important: boolean;
  route: string;
  /** Gli eventi che la notifica copre. */
  events: string[];
}

/** «Il 22 e il 23», «Il 21, il 22 e il 23». */
function daysText(days: readonly string[]): string {
  const names = [...new Set(days)].sort().map((d) => String(Number(d.slice(8, 10))));
  return names.length === 1
    ? `il ${names[0]}`
    : `${names
        .slice(0, -1)
        .map((n) => `il ${n}`)
        .join(', ')} e il ${names.at(-1)}`;
}

/**
 * Le notifiche per gli eventi nuovi (docs/adr/0045): quelli con un'ora di consegna futura vanno da soli a quell'ora,
 * gli altri insieme in una notifica. Le ore silenziose spostano tutto più avanti. Eventi di giorni prima di ieri,
 * arrivati insieme, dicono «Mentre il server non rispondeva». Con `generico` il testo non dice il problema.
 */
export function planNotifications(
  events: readonly AlertEvent[],
  deliveryOf: (rule: string) => AlertDelivery,
  settings: AlertSettings,
  now: Date,
  today: string,
): PlannedNotification[] {
  const wanted = events.filter(
    (e) =>
      e.seenAt === null &&
      deliveryOf(e.rule) !== 'elenco' &&
      e.push !== 'pending' &&
      e.push !== 'sent',
  );
  const later = wanted.filter((e) => e.deliverAfter !== null && e.deliverAfter > now.getTime());
  const nowGroup = wanted.filter((e) => !later.includes(e));
  const generic = settings.lockScreen === 'generico';
  const when = (at: number) =>
    afterQuietHours(new Date(at), settings.quietStart, settings.quietEnd).getTime();
  const plans: PlannedNotification[] = later.map((e) => ({
    id: `alert-${e.id}`,
    title: generic ? 'RingLife' : e.title,
    body: generic ? 'Un nuovo avviso.' : e.body,
    at: when(e.deliverAfter!),
    important: deliveryOf(e.rule) === 'importante',
    route: e.route ?? '/avvisi',
    events: [e.id],
  }));
  if (nowGroup.length === 1) {
    const e = nowGroup[0];
    plans.push({
      id: `alert-${e.id}`,
      title: generic ? 'RingLife' : e.title,
      body: generic ? 'Un nuovo avviso.' : e.body,
      at: when(now.getTime()),
      important: deliveryOf(e.rule) === 'importante',
      route: e.route ?? '/avvisi',
      events: [e.id],
    });
  } else if (nowGroup.length > 1) {
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const old = nowGroup.every((e) => e.day < yesterday.toISOString().slice(0, 10));
    const titles = [...new Set(nowGroup.map((e) => e.title))];
    plans.push({
      id: `alerts-${now.getTime()}`,
      title: generic
        ? 'RingLife'
        : old
          ? `Mentre il server non rispondeva: ${nowGroup.length} avvisi`
          : `${nowGroup.length} avvisi`,
      body: generic
        ? `${nowGroup.length} nuovi avvisi.`
        : old
          ? `${titles.join('; ')}, ${daysText(nowGroup.map((e) => e.day))}.`
          : `${titles.join('; ')}.`,
      at: when(now.getTime()),
      important: nowGroup.some((e) => deliveryOf(e.rule) === 'importante'),
      route: '/avvisi',
      events: nowGroup.map((e) => e.id),
    });
  }
  return plans;
}

/** Ore silenziose proposte nel wizard: dall'ora di coricarsi meno 30 minuti all'ora del risveglio (ADR 0045). */
export function proposedQuietHours(
  bedtime: string,
  wakeTime: string,
): { quietStart: string; quietEnd: string } {
  const bed = minutesOf(bedtime);
  const start = bed === null ? 22 * 60 + 30 : (bed - 30 + 1440) % 1440;
  const text = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { quietStart: text(start), quietEnd: minutesOf(wakeTime) === null ? '07:00' : wakeTime };
}

/** Le soglie proposte nel wizard dagli obiettivi: debito di sonno a tre quarti dell'obiettivo, passi bassi a metà. */
export function proposedThresholds(
  sleepGoalMin: number,
  stepsGoal: number,
): { sleepDebtHours: number; stepsLow: number } {
  return {
    sleepDebtHours: Math.round(((sleepGoalMin * 0.75) / 60) * 2) / 2,
    stepsLow: Math.round(stepsGoal / 2 / 500) * 500,
  };
}
