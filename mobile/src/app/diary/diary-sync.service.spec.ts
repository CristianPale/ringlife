import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsRepository } from '../api/credentials.repository';
import { CredentialsService } from '../api/credentials.service';
import { InMemoryCredentialsRepository } from '../api/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { EMPTY_SYNCED, SyncedDiary, entryPayload, episodePayload } from './diary-sync.model';
import { EMPTY_DETAILS } from './headache.model';
import { DiarySyncRepository } from './diary-sync.repository';
import { DiarySyncService } from './diary-sync.service';
import { HeadacheService } from './headache.service';
import { JournalService } from './journal.service';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from './testing';

const URL = 'https://ringlife.example.net';
const NOW = new Date('2026-11-04T08:00:00Z');

class MemorySyncRepository extends DiarySyncRepository {
  saved: SyncedDiary[] = [];
  constructor(private stored: SyncedDiary = EMPTY_SYNCED) {
    super();
  }
  async load(): Promise<SyncedDiary> {
    return this.stored;
  }
  async save(synced: SyncedDiary): Promise<void> {
    this.stored = synced;
    this.saved.push(synced);
  }
}

describe('DiarySyncService', () => {
  let http: HttpTestingController;
  let journal: JournalService;
  let headaches: HeadacheService;
  let service: DiarySyncService;
  let repository: MemorySyncRepository;

  async function setup(options: { paired?: boolean; synced?: SyncedDiary } = {}) {
    repository = new MemorySyncRepository(options.synced);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ...provideDiaryTesting(new InMemoryHeadacheRepository(), new FakeClock(NOW), new InMemoryJournalRepository()),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: URL }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
        { provide: DiarySyncRepository, useValue: repository },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    journal = TestBed.inject(JournalService);
    headaches = TestBed.inject(HeadacheService);
    await TestBed.inject(SettingsService).init();
    const credentials = TestBed.inject(CredentialsService);
    await credentials.init();
    if (options.paired !== false) {
      await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    }
    await journal.init();
    await headaches.init();
    service = TestBed.inject(DiarySyncService);
    await service.init();
  }

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve));
  const diaryRequest = () => http.expectOne(`${URL}/api/v1/devices/dev-1/diary`);

  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('sends nothing, and says nothing, while the phone is not paired', async () => {
    await setup({ paired: false });
    await journal.addCaffeine('coffee', NOW);
    await service.sync();
    http.expectNone(() => true);
    expect(service.connected()).toBe(false);
  });

  it('sends a new entry with the bearer token and remembers it was sent', async () => {
    await setup();
    const added = await journal.addCaffeine('coffee', NOW);
    expect(service.pending()).toBe(1);

    const done = service.sync();
    const request = diaryRequest();
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(request.request.body.entries).toEqual([{ id: added.id, ts: NOW.getTime(), kind: 'caffeine', drink: 'coffee' }]);
    request.flush({ entries: { upserted: 1, deleted: 0 }, episodes: { upserted: 0, deleted: 0 } });
    await done;

    expect(service.pending()).toBe(0);
    expect(service.error()).toBeNull();
    expect(repository.saved.at(-1)?.entries[added.id]).toBeDefined();
    expect(repository.saved.at(-1)?.target).toBe(`${URL}|dev-1`);
  });

  it('does not send again what the server already has', async () => {
    await setup();
    await journal.addCaffeine('tea', NOW);
    let done = service.sync();
    diaryRequest().flush({});
    await done;
    done = service.sync();
    await done;
    http.expectNone(() => true);
  });

  it('asks the server to delete an entry that was undone after it was sent', async () => {
    await setup();
    const added = await journal.addAlcohol('wine', NOW);
    let done = service.sync();
    diaryRequest().flush({});
    await done;

    await journal.remove(added.id);
    expect(service.pending()).toBe(1);
    done = service.sync();
    const request = diaryRequest();
    expect(request.request.body.deletedEntries).toEqual([added.id]);
    expect(request.request.body.entries).toEqual([]);
    request.flush({});
    await done;
    expect(service.pending()).toBe(0);
  });

  it('sends an episode and sends it again when it changes', async () => {
    await setup();
    const started = await headaches.start(6, NOW);
    let done = service.sync();
    let request = diaryRequest();
    expect(request.request.body.episodes[0]).toMatchObject({ id: started.id, intensity: 6, end: null });
    request.flush({});
    await done;

    await headaches.adjustIntensity(2);
    done = service.sync();
    request = diaryRequest();
    expect(request.request.body.episodes[0].intensity).toBe(8);
    request.flush({});
    await done;
  });

  it('keeps what was not sent when the network fails, tells why, and tries again later', async () => {
    await setup();
    await journal.addCaffeine('coffee', NOW);
    let done = service.sync();
    diaryRequest().error(new ProgressEvent('error'));
    await done;
    expect(service.pending()).toBe(1);
    expect(service.error()?.kind).toBe('offline');
    expect(repository.saved).toHaveLength(0);

    done = service.sync();
    diaryRequest().flush({});
    await done;
    expect(service.pending()).toBe(0);
    expect(service.error()).toBeNull();
  });

  it('reports a revoked token as unauthorized', async () => {
    await setup();
    await journal.addCaffeine('coffee', NOW);
    const done = service.sync();
    diaryRequest().flush({}, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(service.error()?.kind).toBe('unauthorized');
  });

  it('starts from zero when the server or the device changes', async () => {
    await setup();
    const added = await journal.addCaffeine('coffee', NOW);
    const done = service.sync();
    diaryRequest().flush({});
    await done;
    expect(service.pending()).toBe(0);

    await TestBed.inject(SettingsService).update({ serverUrl: 'https://other.example.net' });
    expect(service.pending()).toBe(1);
    const second = service.sync();
    const request = http.expectOne('https://other.example.net/api/v1/devices/dev-1/diary');
    expect(request.request.body.entries[0].id).toBe(added.id);
    request.flush({});
    await second;
  });

  it('loads what was sent before the app was closed, so it is not sent twice', async () => {
    await setup();
    const added = await journal.addCaffeine('coffee', NOW);
    const done = service.sync();
    diaryRequest().flush({});
    await done;
    const saved = repository.saved.at(-1)!;
    expect(saved.entries[added.id]).toBeDefined();

    TestBed.resetTestingModule();
    await setup({ synced: saved });
    // L'elenco inviato torna dall'archivio, ma la voce non c'è più nel diario nuovo: va cancellata sul server.
    expect(service.pending()).toBe(1);
  });

  it('sends after a short wait when the diary changes, once for several changes', async () => {
    await setup();
    vi.useFakeTimers();
    await journal.addCaffeine('coffee', NOW);
    await journal.addCaffeine('tea', NOW);
    TestBed.tick();
    http.expectNone(() => true);
    vi.advanceTimersByTime(3000);
    const request = diaryRequest();
    expect(request.request.body.entries).toHaveLength(2);
    request.flush({});
    vi.useRealTimers();
    await tick();
  });

  it('does not run two sends at once, and runs once more for what changed meanwhile', async () => {
    await setup();
    await journal.addCaffeine('coffee', NOW);
    const first = service.sync();
    const request = diaryRequest();
    await journal.addCaffeine('tea', NOW);
    const second = service.sync();
    expect(await Promise.race([second.then(() => 'done'), tick().then(() => 'waiting')])).toBe('waiting');
    request.flush({});
    await first;
    await tick();
    const again = diaryRequest();
    expect(again.request.body.entries).toHaveLength(1);
    again.flush({});
    await second;
    await tick();
  });

  describe('restore', () => {
    const serverEntry = { id: 'srv-entry-1', ts: NOW.getTime(), kind: 'caffeine' as const, drink: 'tea' };
    const serverEpisode = {
      id: 'srv-episode-1',
      start: NOW.getTime(),
      end: NOW.getTime() + 3_600_000,
      intensity: 5,
      intensityLog: [{ at: NOW.getTime(), value: 5 }],
      medicationAt: [],
      details: { symptoms: ['nausea'], location: 'left', medicationHelp: null, causes: [], notes: '' },
      completedAt: null,
    };
    const getDiary = () => http.expectOne(`${URL}/api/v1/devices/dev-1/diary`);

    it('brings back the diary of the server on a blank phone and does not send it again', async () => {
      await setup();
      expect(service.isBlank()).toBe(true);
      const done = service.restore();
      const request = getDiary();
      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('Authorization')).toBe('Bearer tok-1');
      request.flush({ entries: [serverEntry], episodes: [serverEpisode] });
      expect(await done).toBe(2);

      expect(journal.entries().map((e) => e.id)).toEqual(['srv-entry-1']);
      expect(headaches.episodes()[0]).toMatchObject({ id: 'srv-episode-1', intensity: 5, endedAt: new Date(NOW.getTime() + 3_600_000).toISOString() });
      expect(service.pending()).toBe(0);
      expect(service.isBlank()).toBe(false);
      expect(repository.saved.at(-1)?.entries['srv-entry-1']).toBe(JSON.stringify(entryPayload(journal.entries()[0])));
      expect(repository.saved.at(-1)?.episodes['srv-episode-1']).toBe(JSON.stringify(episodePayload(headaches.episodes()[0])));
      await service.sync();
      http.expectNone(() => true);
    });

    it('leaves what the phone already has, and adds only the rest', async () => {
      await setup();
      const mine = await journal.addCaffeine('coffee', NOW);
      const done = service.restore();
      getDiary().flush({ entries: [{ ...serverEntry, id: mine.id, drink: 'wine' }, serverEntry], episodes: [] });
      expect(await done).toBe(1);
      expect(journal.entries()).toHaveLength(2);
      expect(journal.entries().find((e) => e.id === mine.id)).toMatchObject({ kind: 'caffeine', drink: 'coffee' });
      expect(service.pending()).toBe(1);
    });

    it('does not bring back what was sent and then removed from the phone', async () => {
      await setup();
      const added = await journal.addCaffeine('coffee', NOW);
      let done = service.sync();
      http.expectOne(`${URL}/api/v1/devices/dev-1/diary`).flush({});
      await done;
      await journal.remove(added.id);

      const restored = service.restore();
      getDiary().flush({ entries: [{ id: added.id, ts: NOW.getTime(), kind: 'caffeine', drink: 'coffee' }], episodes: [] });
      expect(await restored).toBe(0);
      expect(journal.entries()).toEqual([]);
      expect(service.pending()).toBe(1);
    });

    it('does nothing without a server, and says why when the network fails', async () => {
      await setup({ paired: false });
      expect(await service.restore()).toBe(0);
      http.expectNone(() => true);

      TestBed.resetTestingModule();
      await setup();
      const done = service.restore();
      getDiary().error(new ProgressEvent('error'));
      expect(await done).toBe(0);
      expect(service.error()?.kind).toBe('offline');
      expect(journal.entries()).toEqual([]);
    });

    it('is not blank once the phone has anything', async () => {
      await setup();
      await headaches.start(6, NOW);
      expect(service.isBlank()).toBe(false);
      expect(EMPTY_DETAILS.symptoms).toEqual([]);
    });
  });
});
