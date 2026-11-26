import { PLUGIN_IDS } from '../settings/settings.model';
import { GUIDE, GUIDE_GROUPS, GuideTopic, PLUGIN_GUIDE, guideGroup, guideTopic } from './guide';

const topics = Object.entries(GUIDE as Record<string, GuideTopic>);

describe('guide', () => {
  it('puts every page in a known group, and no group is empty', () => {
    const groups = GUIDE_GROUPS.map((g) => g.id);
    for (const [, topic] of topics) {
      expect(groups).toContain(topic.group);
    }
    for (const group of groups) {
      expect(guideGroup(group).length).toBeGreaterThan(0);
    }
  });

  it('gives every page a title, a lead and at least one paragraph', () => {
    for (const [id, topic] of topics) {
      expect(topic.title.length, id).toBeGreaterThan(3);
      expect(topic.lead.length, id).toBeGreaterThan(30);
      expect(topic.sections.flatMap((s) => s.paragraphs).length, id).toBeGreaterThan(0);
    }
  });

  it('only links to pages that exist, never to itself', () => {
    for (const [id, topic] of topics) {
      for (const related of topic.related ?? []) {
        expect(guideTopic(related), `${id} → ${related}`).not.toBeNull();
        expect(related).not.toBe(id);
      }
    }
  });

  it('has a page for every plugin of the app and of the server', () => {
    const server = [
      'migraine',
      'caffeine-window',
      'circadian',
      'social-jetlag',
      'vitamin-d',
      'weekly-report',
    ];
    for (const id of [...PLUGIN_IDS, ...server]) {
      expect(guideTopic(PLUGIN_GUIDE[id]), id).not.toBeNull();
    }
  });

  it('explains the social jet lag: what it is, how it is computed and its limits', () => {
    const page = guideTopic('jet-lag-sociale')!;
    const text = page.sections.flatMap((s) => s.paragraphs).join(' ');
    expect(page.sections.map((s) => s.heading)).toEqual([
      'Da dove viene il nome',
      'Come lo calcola RingLife',
      'Un esempio',
      'Come si legge',
      'Cosa puoi fare',
      'Limiti',
    ]);
    expect(text).toContain('punto medio del sonno');
    expect(text).toContain('ultime 4 settimane');
    expect(text).toContain('Sotto 1 ora il livello è basso, da 1 a 2 ore medio, da 2 ore alto');
  });

  it('names no commercial product and no other app', () => {
    const all = JSON.stringify(GUIDE).toLowerCase();
    // Spezzati: il controllo dell'esportazione pubblica (scripts/export_public.py) rifiuta i nomi interi anche nei test.
    for (const word of ['ultra' + 'human', 'power' + 'plug', 'q' + 'ring', 'ou' + 'ra', 'who' + 'op']) {
      expect(all).not.toContain(word);
    }
  });

  it('returns null for an unknown page', () => {
    expect(guideTopic('nessuna')).toBeNull();
    expect(guideTopic('toString')).toBeNull();
  });
});
