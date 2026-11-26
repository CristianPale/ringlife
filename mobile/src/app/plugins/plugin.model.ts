import { Zone } from '../oggi/zone';

/** Azioni che l'app sa eseguire per una card (docs/adr/0013). Il server non può mandare altrove. */
export const PLUGIN_ACTIONS = ['open-diary', 'log-headache', 'open-breathing'] as const;
export type PluginAction = (typeof PLUGIN_ACTIONS)[number];

export interface PluginRow {
  label: string;
  value: string;
}

/** Le card che l'app sa disegnare. Un tipo che non conosce non arriva fin qui: `readCards` lo scarta. */
export type PluginCard =
  | { type: 'score'; title: string; value: number; zone: Zone; caption: string | null }
  | { type: 'trend'; title: string; points: readonly (number | null)[]; unit: string | null; caption: string | null }
  | { type: 'list'; title: string; rows: readonly PluginRow[] }
  | { type: 'text'; title: string | null; body: string }
  | { type: 'action'; label: string; action: PluginAction };

export interface PluginInsight {
  level: 'info' | 'attenzione';
  title: string;
  text: string;
}

export interface PluginField {
  key: string;
  label: string;
  type: 'INT' | 'BOOL' | 'TIME';
  defaultValue: number | boolean | string;
  min: number | null;
  max: number | null;
}

/** Ogni quanto cambia il risultato (docs/adr/0041): i quotidiani stanno in Oggi, i settimanali in Andamento. */
export type PluginCadence = 'daily' | 'weekly';

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  requires: readonly string[];
  config: readonly PluginField[];
  /** Assente nei server prima dell'ADR 0041: vale `daily`. */
  cadence?: PluginCadence;
}

/** La sintesi del risultato in poche parole, accanto al nome del plugin in Oggi (docs/adr/0041). */
export interface PluginHeadline {
  value: string;
  /** `attenzione`: ambra, sempre con icona e parole. */
  tone: 'attenzione' | null;
}

/** Un plugin come lo manda il server: manifest, stato e risultato del giorno (null se spento o non calcolato). */
export interface PluginView {
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
  result: { cards: readonly unknown[]; insights: readonly unknown[]; headline?: unknown } | null;
}

/** La cadenza del manifest; un valore assente o sconosciuto vale `daily`, così il plugin resta in Oggi. */
export function cadenceOf(manifest: PluginManifest): PluginCadence {
  return manifest.cadence === 'weekly' ? 'weekly' : 'daily';
}

/** La sintesi del risultato, se c'è e ha la forma giusta. I risultati salvati prima dell'ADR 0041 non l'hanno. */
export function readHeadline(raw: unknown): PluginHeadline | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const headline = raw as Record<string, unknown>;
  return isText(headline['value'])
    ? { value: headline['value'].trim(), tone: headline['tone'] === 'attenzione' ? 'attenzione' : null }
    : null;
}

const ZONES: readonly string[] = ['ottimo', 'buono', 'attenzione'];

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const optionalText = (value: unknown): string | null => (isText(value) ? value : null);

function readCard(raw: unknown): PluginCard | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const card = raw as Record<string, unknown>;
  switch (card['type']) {
    case 'score':
      return isText(card['title']) &&
        typeof card['value'] === 'number' &&
        card['value'] >= 0 &&
        card['value'] <= 100 &&
        ZONES.includes(card['zone'] as string)
        ? { type: 'score', title: card['title'], value: Math.round(card['value']), zone: card['zone'] as Zone, caption: optionalText(card['caption']) }
        : null;
    case 'trend':
      return isText(card['title']) && Array.isArray(card['points'])
        ? {
            type: 'trend',
            title: card['title'],
            points: card['points'].map((p) => (typeof p === 'number' && Number.isFinite(p) ? p : null)),
            unit: optionalText(card['unit']),
            caption: optionalText(card['caption']),
          }
        : null;
    case 'list': {
      if (!isText(card['title']) || !Array.isArray(card['rows'])) {
        return null;
      }
      const rows = card['rows']
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .filter((r) => isText(r['label']) && isText(r['value']))
        .map((r) => ({ label: r['label'] as string, value: r['value'] as string }));
      return { type: 'list', title: card['title'], rows };
    }
    case 'text':
      return isText(card['body']) ? { type: 'text', title: optionalText(card['title']), body: card['body'] } : null;
    case 'action':
      return isText(card['label']) && (PLUGIN_ACTIONS as readonly string[]).includes(card['action'] as string)
        ? { type: 'action', label: card['label'], action: card['action'] as PluginAction }
        : null;
    default:
      // Un tipo nuovo di un server più recente: si ignora, non rompe l'app.
      return null;
  }
}

/** Le card riconosciute, nell'ordine del server. Quelle sconosciute o malformate si scartano. */
export function readCards(raw: readonly unknown[]): PluginCard[] {
  return raw.map(readCard).filter((card): card is PluginCard => card !== null);
}

export function readInsights(raw: readonly unknown[]): PluginInsight[] {
  return raw
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .filter((i) => (i['level'] === 'info' || i['level'] === 'attenzione') && isText(i['title']) && isText(i['text']))
    .map((i) => ({ level: i['level'] as PluginInsight['level'], title: i['title'] as string, text: i['text'] as string }));
}
