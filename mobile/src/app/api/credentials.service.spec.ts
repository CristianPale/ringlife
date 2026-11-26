import { TestBed } from '@angular/core/testing';
import { CredentialsRepository, normalizeCredentials } from './credentials.repository';
import { CredentialsService } from './credentials.service';
import { InMemoryCredentialsRepository } from './testing';

describe('CredentialsService', () => {
  function create(stored: ConstructorParameters<typeof InMemoryCredentialsRepository>[0] = null) {
    const repository = new InMemoryCredentialsRepository(stored);
    TestBed.configureTestingModule({ providers: [{ provide: CredentialsRepository, useValue: repository }] });
    return { service: TestBed.inject(CredentialsService), repository };
  }

  it('creates a hardware id on first start and saves it straight away', async () => {
    const { service, repository } = create();
    const before = service.hardwareId();
    await service.init();
    expect(before).toMatch(/^phone-.+/);
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0].hardwareId).toBe(before);
    expect(service.paired()).toBeNull();
  });

  it('keeps the same hardware id across restarts', async () => {
    const first = create();
    await first.service.init();
    const id = first.service.hardwareId();
    TestBed.resetTestingModule();
    const second = create(first.repository.saved[0]);
    await second.service.init();
    expect(second.service.hardwareId()).toBe(id);
  });

  it('saves and forgets the pairing, but keeps the hardware id', async () => {
    const { service, repository } = create();
    await service.init();
    const id = service.hardwareId();
    await service.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    expect(service.paired()).toEqual({ deviceId: 'dev-1', token: 'tok-1' });
    expect(repository.saved.at(-1)?.paired?.token).toBe('tok-1');

    await service.forget();
    expect(service.paired()).toBeNull();
    expect(service.hardwareId()).toBe(id);
    expect(repository.saved.at(-1)?.paired).toBeNull();
  });

  it('does not write when there is nothing to forget', async () => {
    const { service, repository } = create();
    await service.init();
    const writes = repository.saved.length;
    await service.forget();
    expect(repository.saved).toHaveLength(writes);
  });

  it('takes an existing hardware id before pairing, and keeps it after a restart', async () => {
    const { service, repository } = create();
    await service.init();
    expect(await service.useHardwareId('  phone-aaaa-bbbb-cccc  ')).toBe(true);
    expect(service.hardwareId()).toBe('phone-aaaa-bbbb-cccc');
    expect(repository.saved.at(-1)?.hardwareId).toBe('phone-aaaa-bbbb-cccc');
  });

  it('refuses an id that is too short, too long or has odd characters, and keeps its own', async () => {
    const { service } = create();
    await service.init();
    const own = service.hardwareId();
    for (const bad of ['', 'short', 'x'.repeat(81), 'phone aaaa bbbb', 'phone/aaaa/bbbb', 'phone-ààààààà']) {
      expect(await service.useHardwareId(bad)).toBe(false);
    }
    expect(service.hardwareId()).toBe(own);
  });

  it('does not change the id once paired', async () => {
    const { service } = create();
    await service.init();
    const own = service.hardwareId();
    await service.savePaired({ deviceId: 'd', token: 't' });
    expect(await service.useHardwareId('phone-aaaa-bbbb-cccc')).toBe(false);
    expect(service.hardwareId()).toBe(own);
  });

  it('works without a repository', async () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(CredentialsService);
    await service.init();
    await service.savePaired({ deviceId: 'd', token: 't' });
    expect(service.paired()?.deviceId).toBe('d');
  });

  describe('normalizeCredentials', () => {
    it('rejects anything unreadable', () => {
      expect(normalizeCredentials(null)).toBeNull();
      expect(normalizeCredentials('x')).toBeNull();
      expect(normalizeCredentials({})).toBeNull();
      expect(normalizeCredentials({ hardwareId: '' })).toBeNull();
    });

    it('drops an incomplete pairing but keeps the hardware id', () => {
      expect(normalizeCredentials({ hardwareId: 'h', paired: { deviceId: 'd' } })).toEqual({ hardwareId: 'h', paired: null });
      expect(normalizeCredentials({ hardwareId: 'h', paired: { deviceId: '', token: 't' } })).toEqual({
        hardwareId: 'h',
        paired: null,
      });
    });

    it('keeps a complete pairing', () => {
      expect(normalizeCredentials({ hardwareId: 'h', paired: { deviceId: 'd', token: 't' } })).toEqual({
        hardwareId: 'h',
        paired: { deviceId: 'd', token: 't' },
      });
    });
  });
});
