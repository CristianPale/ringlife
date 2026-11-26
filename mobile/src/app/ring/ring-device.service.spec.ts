import { TestBed } from '@angular/core/testing';
import { SettingsService } from '../settings/settings.service';
import { RingDeviceRepository, InMemoryRingDeviceRepository } from './ring-device.repository';
import { RingDeviceService } from './ring-device.service';
import { RingSourceProvider } from './ring-source.provider';

const INFO = { name: 'COLMI Ring 2', firmware: '3.00.03', hardware: null, address: null };

describe('RingDeviceService', () => {
  async function create(repository = new InMemoryRingDeviceRepository()) {
    TestBed.configureTestingModule({ providers: [{ provide: RingDeviceRepository, useValue: repository }] });
    const service = TestBed.inject(RingDeviceService);
    await service.init();
    return { service, repository };
  }

  it('starts linked and without a ring, and loads what was saved', async () => {
    const { service } = await create(
      new InMemoryRingDeviceRepository({ device: { ...INFO, seenAt: 1, previousFirmware: null, firmwareChangedAt: null }, unlinked: true }),
    );
    expect(service.device()?.name).toBe('COLMI Ring 2');
    expect(service.linked()).toBe(false);
  });

  it('records the ring, unlinks it keeping it, and relinks it', async () => {
    const { service, repository } = await create();
    expect(service.linked()).toBe(true);
    await service.recordSeen(INFO, 10);
    await service.unlink();
    expect(service.linked()).toBe(false);
    expect(service.device()?.seenAt).toBe(10);
    await service.relink();
    expect(service.linked()).toBe(true);
    expect(repository.saved.at(-1)).toEqual({ device: expect.objectContaining({ name: 'COLMI Ring 2' }), unlinked: false });
  });

  it('forgets the ring and the pairing the system gave it, and stays linked for the next one', async () => {
    const { service, repository } = await create();
    await service.recordSeen(INFO, 10);
    await service.unlink();
    await service.forget();
    expect(service.device()).toBeNull();
    expect(service.linked()).toBe(true);
    expect(repository.pairingForgotten).toBe(1);
  });

  it('makes the ring source refuse to read an unlinked ring, also for the live heart rate', async () => {
    const { service } = await create();
    await service.unlink();
    const source = TestBed.inject(RingSourceProvider).current();
    expect(source.kind).toBe('none');
    await expect(source.connect()).rejects.toMatchObject({ code: 'not_linked' });
    await expect(source.startLiveHeartRate(() => undefined)).rejects.toMatchObject({ code: 'not_linked' });
    // L'anello di prova resta usabile: non è l'anello scollegato.
    await TestBed.inject(SettingsService).update({ demoRing: true });
    expect(TestBed.inject(RingSourceProvider).current().kind).toBe('demo');
  });
});
