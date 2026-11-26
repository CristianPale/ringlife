import { EMPTY_DETAILS, normalizeEpisode } from './headache.model';

describe('normalizeEpisode', () => {
  it('upgrades an episode saved before details existed', () => {
    const legacy = {
      id: 'a',
      startedAt: '2026-11-03T07:44:00.000Z',
      endedAt: '2026-11-03T08:56:00.000Z',
      intensity: 6,
      intensityLog: [{ at: '2026-11-03T07:44:00.000Z', value: 6 }],
      medicationAt: ['2026-11-03T07:58:00.000Z'],
    };
    const episode = normalizeEpisode(legacy);

    expect(episode?.details).toEqual(EMPTY_DETAILS);
    expect(episode?.completedAt).toBeNull();
    expect(episode?.medicationAt).toHaveLength(1);
  });

  it('keeps saved details', () => {
    const episode = normalizeEpisode({
      id: 'a',
      startedAt: '2026-11-03T07:44:00.000Z',
      details: { symptoms: ['nausea'], location: 'right', medicationHelp: null, causes: [], notes: 'x' },
      completedAt: '2026-11-03T09:00:00.000Z',
    });

    expect(episode?.details.symptoms).toEqual(['nausea']);
    expect(episode?.completedAt).toBe('2026-11-03T09:00:00.000Z');
  });

  it('drops records without an id or a start', () => {
    expect(normalizeEpisode({})).toBeNull();
    expect(normalizeEpisode({ id: 'a' })).toBeNull();
  });
});
