import { PreferencesHeadacheRepository } from './headache.repository';

const KEY = 'CapacitorStorage.headache.episodes.v1';

describe('PreferencesHeadacheRepository', () => {
  const repository = new PreferencesHeadacheRepository();

  afterEach(() => localStorage.removeItem(KEY));

  it('returns an empty list when nothing is saved', async () => {
    expect(await repository.load()).toEqual([]);
  });

  it('round-trips episodes', async () => {
    const episode = {
      id: 'a',
      startedAt: '2026-11-03T07:44:00.000Z',
      endedAt: null,
      intensity: 6,
      intensityLog: [],
      medicationAt: [],
      details: { symptoms: [], location: null, medicationHelp: null, causes: [], notes: '' },
      completedAt: null,
    };
    await repository.save([episode]);
    expect(await repository.load()).toEqual([episode]);
  });

  it('upgrades data saved by the first version', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ id: 'a', startedAt: '2026-11-03T07:44:00.000Z', endedAt: null, intensity: 4 }]),
    );
    const [episode] = await repository.load();
    expect(episode.details.symptoms).toEqual([]);
    expect(episode.completedAt).toBeNull();
    expect(episode.medicationAt).toEqual([]);
  });

  it('starts empty instead of failing on unreadable data', async () => {
    localStorage.setItem(KEY, '{not json');
    expect(await repository.load()).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}');
    expect(await repository.load()).toEqual([]);
  });
});
