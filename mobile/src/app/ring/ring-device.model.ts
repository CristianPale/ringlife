/**
 * Ciò che l'anello dice di sé (servizio Device Information, `180a`) e il nome Bluetooth (docs/adr/0030). Sta solo sul
 * telefono: mai nel server, nei log o nel repo.
 */
export interface RingDeviceInfo {
  name: string | null;
  firmware: string | null;
  hardware: string | null;
  /** Indirizzo MAC: solo Android lo dà alle app. Su iPhone `null`. */
  address: string | null;
}

export interface RingDevice extends RingDeviceInfo {
  /** L'ultima volta che l'app ha letto questi dati, ms. */
  seenAt: number;
  /** Il firmware di prima, dall'ultima volta che è cambiato: l'anello è stato aggiornato. */
  previousFirmware: string | null;
  /** Quando l'app ha visto cambiare il firmware, ms. */
  firmwareChangedAt: number | null;
}

/** Ciò che il telefono ricorda dell'anello: chi è, e se l'utente l'ha scollegato da RingLife. */
export interface RingDeviceState {
  device: RingDevice | null;
  /** Scollegato con «Disconnetti»: l'app non lo legge finché non si tocca «Riconnetti». */
  unlinked: boolean;
}

export const EMPTY_DEVICE_STATE: RingDeviceState = { device: null, unlinked: false };

/** La versione del firmware su cui sono stati verificati i formati (docs/protocol.md). */
export const VERIFIED_FIRMWARE = '3.00.03';

/** Com'è il firmware letto rispetto a `VERIFIED_FIRMWARE`. `unknown`: non si riesce a leggerne la versione. */
export type FirmwareCheck = 'verified' | 'newer' | 'older' | 'unknown';

/** Il testo di una caratteristica Device Information: UTF-8, senza gli zeri finali. Vuoto = `null`. */
export function decodeDeviceText(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes).replace(/\0+$/, '').trim();
  return text === '' ? null : text;
}

/** I tre numeri della versione: `3.00.03` anche dentro `RT09CR2_3.00.03_260929`. */
export function firmwareVersion(text: string | null): [number, number, number] | null {
  const match = text ? /(\d+)\.(\d+)\.(\d+)/.exec(text) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** La versione leggibile, `3.00.03`, o il testo intero se non ne contiene una. */
export function firmwareLabel(text: string | null): string | null {
  const match = text ? /\d+\.\d+\.\d+/.exec(text) : null;
  return match ? match[0] : text;
}

export function checkFirmware(text: string | null): FirmwareCheck {
  const found = firmwareVersion(text);
  const verified = firmwareVersion(VERIFIED_FIRMWARE)!;
  if (!found) {
    return 'unknown';
  }
  for (let i = 0; i < 3; i++) {
    if (found[i] !== verified[i]) {
      return found[i] > verified[i] ? 'newer' : 'older';
    }
  }
  return 'verified';
}

/** Per quanto la scheda dice che il firmware è cambiato. */
export const FIRMWARE_CHANGE_NOTICE_MS = 14 * 86_400_000;

/**
 * Una frase sul firmware: com'è rispetto alla versione verificata e, se è cambiato da meno di due settimane, da quale
 * si è passati.
 */
export function firmwareNote(device: Pick<RingDevice, 'firmware' | 'previousFirmware' | 'firmwareChangedAt'>, now: number): string | null {
  const parts: string[] = [];
  switch (checkFirmware(device.firmware)) {
    case 'verified':
      parts.push('È la versione su cui RingLife è stato provato.');
      break;
    case 'newer':
      parts.push(
        `Più recente della ${VERIFIED_FIRMWARE}, quella su cui RingLife è stato provato: se una misura manca o sembra strana, può dipendere da qui.`,
      );
      break;
    case 'older':
      parts.push(
        `Più vecchia della ${VERIFIED_FIRMWARE}, quella su cui RingLife è stato provato: se una misura manca o sembra strana, può dipendere da qui.`,
      );
      break;
  }
  const recent = device.firmwareChangedAt !== null && now - device.firmwareChangedAt < FIRMWARE_CHANGE_NOTICE_MS;
  if (recent && device.previousFirmware && device.previousFirmware !== device.firmware) {
    parts.push(`Aggiornato dalla ${firmwareLabel(device.previousFirmware)}.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Una lettura nuova: i campi che l'anello non ha dato restano quelli di prima. Il firmware vecchio si ricorda quando cambia. */
export function mergeDevice(previous: RingDevice | null, info: RingDeviceInfo, at: number): RingDevice {
  const firmware = info.firmware ?? previous?.firmware ?? null;
  const changed = previous?.firmware != null && firmware !== null && firmware !== previous.firmware;
  return {
    name: info.name ?? previous?.name ?? null,
    firmware,
    hardware: info.hardware ?? previous?.hardware ?? null,
    address: info.address ?? previous?.address ?? null,
    seenAt: at,
    previousFirmware: changed ? previous!.firmware : (previous?.previousFirmware ?? null),
    firmwareChangedAt: changed ? at : (previous?.firmwareChangedAt ?? null),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Ciò che si legge dall'archivio: un campo illeggibile diventa `null`, un dispositivo senza data non c'è. */
export function normalizeDevice(raw: unknown): RingDevice | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const d = raw as Record<string, unknown>;
  if (typeof d['seenAt'] !== 'number' || !Number.isFinite(d['seenAt'])) {
    return null;
  }
  return {
    name: text(d['name']),
    firmware: text(d['firmware']),
    hardware: text(d['hardware']),
    address: text(d['address']),
    seenAt: d['seenAt'],
    previousFirmware: text(d['previousFirmware']),
    firmwareChangedAt: typeof d['firmwareChangedAt'] === 'number' && Number.isFinite(d['firmwareChangedAt']) ? d['firmwareChangedAt'] : null,
  };
}
