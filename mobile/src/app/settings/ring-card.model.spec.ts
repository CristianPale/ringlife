import { RingDevice } from '../ring/ring-device.model';
import { RingCardInput, describeRingCard, wearLabel } from './ring-card.model';
import { DEFAULT_SETTINGS } from './settings.model';

const NOW = new Date('2026-11-18T08:00:00Z');
const RING: RingDevice = {
  name: 'COLMI Ring 2',
  firmware: 'RT09CR2_3.00.03_260929',
  hardware: null,
  address: null,
  seenAt: NOW.getTime(),
  previousFirmware: null,
  firmwareChangedAt: null,
};

const input = (patch: Partial<RingCardInput> = {}): RingCardInput => ({
  native: true,
  demo: false,
  linked: true,
  device: RING,
  last: { at: NOW.getTime() - 60_000, battery: 74, firmware: null },
  ringError: null,
  wear: DEFAULT_SETTINGS.wear,
  now: NOW,
  ...patch,
});

describe('describeRingCard', () => {
  it('shows a ring read by RingLife with its name, firmware, address, battery and finger, and offers to disconnect', () => {
    const view = describeRingCard(input());
    expect(view.state).toBe('connected');
    expect(view.title).toBe('COLMI Ring 2');
    expect(view.status).toMatch(/^Collegato · sincronizzato alle \d\d:\d\d$/);
    expect(view.rows).toEqual([
      { label: 'Firmware', value: '3.00.03', mono: true },
      { label: 'Indirizzo (MAC)', value: 'iPhone non lo mostra alle app', mono: false },
      { label: 'Batteria', value: '74%', mono: true },
      { label: 'Al dito', value: 'indice sinistro', mono: false },
    ]);
    expect(view.note).toBe('È la versione su cui RingLife è stato provato.');
    expect(view.action).toEqual({ kind: 'disconnect', label: 'Disconnetti' });
  });

  it('shows the address where the phone gives it (Android)', () => {
    const view = describeRingCard(input({ device: { ...RING, address: 'indirizzo-del-sistema' } }));
    expect(view.rows[1]).toEqual({ label: 'Indirizzo (MAC)', value: 'indirizzo-del-sistema', mono: true });
  });

  it('offers to reconnect a ring the last reading did not reach, and says why', () => {
    const view = describeRingCard(input({ ringError: "Non trovo l'anello." }));
    expect(view.state).toBe('unreachable');
    expect(view.note).toBe("Non trovo l'anello.");
    expect(view.action).toEqual({ kind: 'reconnect', label: 'Riconnetti' });
  });

  it('offers to reconnect or replace an unlinked ring', () => {
    const view = describeRingCard(input({ linked: false }));
    expect(view.state).toBe('unlinked');
    expect(view.status).toBe('Scollegato da RingLife');
    expect(view.action?.kind).toBe('reconnect');
    expect(view.canForget).toBe(true);
  });

  it('offers to connect a device when the phone has never read one', () => {
    const view = describeRingCard(input({ device: null, last: null }));
    expect(view.state).toBe('none');
    expect(view.title).toBe('Nessun anello collegato');
    expect(view.action).toEqual({ kind: 'connect', label: 'Collega dispositivo' });
    expect(describeRingCard(input({ device: null, ringError: 'Il Bluetooth è spento.' })).note).toBe('Il Bluetooth è spento.');
  });

  it('has no button for the demo ring or in the browser', () => {
    expect(describeRingCard(input({ demo: true }))).toMatchObject({ state: 'demo', action: null });
    expect(describeRingCard(input({ native: false }))).toMatchObject({ state: 'web', action: null });
  });

  it('names the finger the ring is worn on', () => {
    expect(wearLabel({ hand: 'right', finger: 'ring' })).toBe('anulare destro');
    expect(wearLabel({ hand: 'left', finger: 'middle' })).toBe('medio sinistro');
  });
});
