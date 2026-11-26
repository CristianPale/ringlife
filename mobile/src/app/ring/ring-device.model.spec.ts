import {
  FIRMWARE_CHANGE_NOTICE_MS,
  RingDevice,
  checkFirmware,
  decodeDeviceText,
  firmwareLabel,
  firmwareNote,
  firmwareVersion,
  mergeDevice,
  normalizeDevice,
} from './ring-device.model';

const DAY = 86_400_000;
const device = (patch: Partial<RingDevice> = {}): RingDevice => ({
  name: 'COLMI Ring 2',
  firmware: '3.00.03',
  hardware: 'R09',
  address: null,
  seenAt: 1000,
  previousFirmware: null,
  firmwareChangedAt: null,
  ...patch,
});

describe('ring device', () => {
  it('reads the Device Information text without trailing zeros or spaces', () => {
    expect(decodeDeviceText(new TextEncoder().encode('3.00.03\0\0'))).toBe('3.00.03');
    expect(decodeDeviceText(new TextEncoder().encode(' RT09 '))).toBe('RT09');
    expect(decodeDeviceText(new Uint8Array([0, 0]))).toBeNull();
  });

  it('finds the version also inside the long firmware identifier', () => {
    expect(firmwareVersion('RT09CR2_3.00.03_260929')).toEqual([3, 0, 3]);
    expect(firmwareLabel('RT09CR2_3.00.03_260929')).toBe('3.00.03');
    expect(firmwareLabel('beta')).toBe('beta');
    expect(firmwareVersion(null)).toBeNull();
  });

  it('compares the firmware with the version the formats were verified on', () => {
    expect(checkFirmware('3.00.03')).toBe('verified');
    expect(checkFirmware('RT09CR2_3.00.04_261201')).toBe('newer');
    expect(checkFirmware('3.1.0')).toBe('newer');
    expect(checkFirmware('3.00.02')).toBe('older');
    expect(checkFirmware('2.99.99')).toBe('older');
    expect(checkFirmware('beta')).toBe('unknown');
    expect(checkFirmware(null)).toBe('unknown');
  });

  it('says how the firmware compares, and from which version it was updated for two weeks', () => {
    expect(firmwareNote(device(), 0)).toBe('È la versione su cui RingLife è stato provato.');
    expect(firmwareNote(device({ firmware: '3.00.02' }), 0)).toContain('Più vecchia della 3.00.03');
    expect(firmwareNote(device({ firmware: '3.00.05' }), 0)).toContain('Più recente della 3.00.03');
    expect(firmwareNote(device({ firmware: 'beta' }), 0)).toBeNull();
    const updated = device({ firmware: '3.00.04', previousFirmware: 'RT09_3.00.03', firmwareChangedAt: 10 * DAY });
    expect(firmwareNote(updated, 11 * DAY)).toContain('Aggiornato dalla 3.00.03.');
    expect(firmwareNote(updated, 10 * DAY + FIRMWARE_CHANGE_NOTICE_MS)).not.toContain('Aggiornato');
  });

  it('keeps what a reading did not give, and remembers the old firmware when it changes', () => {
    const first = mergeDevice(null, { name: 'COLMI Ring 2', firmware: '3.00.03', hardware: null, address: null }, 1);
    expect(first).toEqual(device({ hardware: null, seenAt: 1 }));
    const same = mergeDevice(first, { name: null, firmware: null, hardware: 'R09', address: null }, 2);
    expect(same).toMatchObject({ name: 'COLMI Ring 2', firmware: '3.00.03', hardware: 'R09', seenAt: 2, previousFirmware: null });
    const updated = mergeDevice(same, { name: null, firmware: '3.00.04', hardware: null, address: null }, 3);
    expect(updated).toMatchObject({ firmware: '3.00.04', previousFirmware: '3.00.03', firmwareChangedAt: 3 });
    const later = mergeDevice(updated, { name: null, firmware: '3.00.04', hardware: null, address: null }, 4);
    expect(later).toMatchObject({ previousFirmware: '3.00.03', firmwareChangedAt: 3 });
  });

  it('drops what it cannot read from storage', () => {
    expect(normalizeDevice(null)).toBeNull();
    expect(normalizeDevice({ name: 'x' })).toBeNull();
    expect(normalizeDevice({ seenAt: 5, name: 7, firmware: '', address: 'AA' })).toEqual({
      name: null,
      firmware: null,
      hardware: null,
      address: 'AA',
      seenAt: 5,
      previousFirmware: null,
      firmwareChangedAt: null,
    });
  });
});
