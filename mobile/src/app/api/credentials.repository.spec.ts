import { TestBed } from '@angular/core/testing';
import { CredentialsService } from './credentials.service';
import { CredentialsRepository, SplitCredentialsRepository } from './credentials.repository';
import { PLAIN_STORE, SECRET_STORE } from './key-value-store';
import { InMemoryKeyValueStore } from './testing';

const PLAIN = 'credentials.v1';
const SECRET = 'credentials.paired.v1';

describe('SplitCredentialsRepository', () => {
  let plain: InMemoryKeyValueStore;
  let secret: InMemoryKeyValueStore;
  let repository: SplitCredentialsRepository;

  beforeEach(() => {
    plain = new InMemoryKeyValueStore();
    secret = new InMemoryKeyValueStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLAIN_STORE, useValue: plain },
        { provide: SECRET_STORE, useValue: secret },
        { provide: CredentialsRepository, useClass: SplitCredentialsRepository },
      ],
    });
    repository = TestBed.inject(CredentialsRepository) as SplitCredentialsRepository;
  });

  it('keeps the token in the keychain and never in plain preferences', async () => {
    await repository.save({ hardwareId: 'phone-12345678', paired: { deviceId: 'dev-1', token: 'secret-token' } });
    expect(plain.values.get(PLAIN)).not.toContain('secret-token');
    expect(JSON.parse(plain.values.get(PLAIN) ?? '{}')).toEqual({ hardwareId: 'phone-12345678', paired: null });
    expect(secret.values.get(SECRET)).toContain('secret-token');
    expect(await repository.load()).toEqual({
      hardwareId: 'phone-12345678',
      paired: { deviceId: 'dev-1', token: 'secret-token' },
    });
  });

  it('removes the keychain item when the pairing is forgotten, and keeps the hardware id', async () => {
    await repository.save({ hardwareId: 'phone-12345678', paired: { deviceId: 'dev-1', token: 't' } });
    await repository.save({ hardwareId: 'phone-12345678', paired: null });
    expect(secret.values.has(SECRET)).toBe(false);
    expect(await repository.load()).toEqual({ hardwareId: 'phone-12345678', paired: null });
  });

  it('returns null when nothing was ever saved', async () => {
    expect(await repository.load()).toBeNull();
  });

  it('moves a token left in preferences by an older version into the keychain', async () => {
    plain.values.set(PLAIN, JSON.stringify({ hardwareId: 'phone-12345678', paired: { deviceId: 'dev-1', token: 'old-token' } }));
    const loaded = await repository.load();
    expect(loaded?.paired).toEqual({ deviceId: 'dev-1', token: 'old-token' });
    expect(secret.values.get(SECRET)).toContain('old-token');
    expect(plain.values.get(PLAIN)).not.toContain('old-token');
    // Il secondo avvio legge dal portachiavi.
    expect((await repository.load())?.paired?.token).toBe('old-token');
  });

  it('does not treat an unreadable keychain as an empty one during migration', async () => {
    plain.values.set(PLAIN, JSON.stringify({ hardwareId: 'phone-12345678', paired: { deviceId: 'dev-1', token: 'old-token' } }));
    secret.failing = true;
    // La lettura del portachiavi fallisce: nessun «assente», l'errore si propaga e non si scrive nulla.
    await expect(repository.load()).rejects.toThrow();
    expect(plain.values.get(PLAIN)).toContain('old-token');
  });

  it('does not write over a keychain that does not answer', async () => {
    await repository.save({ hardwareId: 'phone-12345678', paired: { deviceId: 'dev-1', token: 'tok' } });
    secret.failing = true;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLAIN_STORE, useValue: plain },
        { provide: SECRET_STORE, useValue: secret },
        { provide: CredentialsRepository, useClass: SplitCredentialsRepository },
      ],
    });
    const service = TestBed.inject(CredentialsService);
    await service.init();
    expect(service.paired()).toBeNull();
    secret.failing = false;
    // Il collegamento è ancora lì: l'avvio non lo ha cancellato.
    expect((await TestBed.inject(CredentialsRepository).load())?.paired?.token).toBe('tok');
  });
});
