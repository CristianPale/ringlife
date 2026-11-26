import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeadacheService } from '../diary/headache.service';
import { JournalService } from '../diary/journal.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from '../diary/testing';
import { PluginView } from '../plugins/plugin.model';
import { PluginsService } from '../plugins/plugins.service';
import { SettingsService } from '../settings/settings.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { OggiDataService } from './oggi-data.service';
import { formatThousands } from '../shared/format';
import { OggiPage, formatDay } from './oggi.page';

describe('OggiPage', () => {
  const clock = new FakeClock(new Date(2026, 10, 3, 7, 44));

  async function render(openEpisode = false) {
    await TestBed.configureTestingModule({
      imports: [OggiPage],
      providers: [provideRouter([]), ...provideDiaryTesting(new InMemoryHeadacheRepository(), clock)],
    }).compileComponents();
    if (openEpisode) {
      await TestBed.inject(HeadacheService).start(6, clock.now());
    }
    const fixture = TestBed.createComponent(OggiPage);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  it('puts the Recupero at the centre of the giro and the other indices in the fixed order below', async () => {
    const root = await render();
    expect(root.querySelector('app-giro')?.getAttribute('aria-label') ?? root.querySelector('app-giro svg')?.getAttribute('aria-label')).toContain('Recupero 64');
    const names = Array.from(root.querySelectorAll('.indices .name')).map((el) => el.textContent?.trim());
    expect(names).toEqual(['Sonno', 'Movimento', 'Stress, ieri']);
  });

  it('opens the Recupero detail from the giro', async () => {
    const root = await render();
    expect(root.querySelector('a.giro-link')?.getAttribute('href')).toBe('/indici/recupero');
  });

  it('opens the Sonno, Movimento and Stress pages from their rows', async () => {
    const root = await render();
    const links = Array.from(root.querySelectorAll('a.row-link')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/tabs/sonno', '/indici/movimento', '/indici/stress']);
    expect(root.querySelector('a.row-link[href="/indici/movimento"] app-movement-row')).not.toBeNull();
  });

  it('says where each index stands against your average in words, not only by colour', async () => {
    const root = await render();
    const rows = root.querySelector('.indices')?.textContent ?? '';
    expect(rows).toContain('Peggio del solito');
    expect(rows).toContain('Come al solito');
    expect(root.querySelector('app-giro svg')?.getAttribute('aria-label')).toContain('peggio del solito');
  });

  it('colours only the words about your average in the daily sentence', async () => {
    const root = await render();
    const toned = Array.from(root.querySelectorAll('.summary [data-tone]')).filter((el) => el.getAttribute('data-tone'));
    expect(toned.map((el) => el.textContent)).toEqual(['sotto la tua media']);
    expect(toned[0].getAttribute('data-tone')).toBe('peggio');
    expect(root.querySelector('h1.summary-main')).not.toBeNull();
  });

  it('draws the usual sleep, last night and now on the giro, and the caffeine window only when there is one', async () => {
    const root = await render();
    expect(root.querySelector('app-giro .usual-arc')).not.toBeNull();
    expect(root.querySelector('app-giro .sleep-arc')).not.toBeNull();
    expect(root.querySelector('app-giro .now')).not.toBeNull();
    expect(root.querySelector('app-giro .caffeine-arc')).not.toBeNull();
    expect(root.querySelector('.legend')?.textContent).toContain('caffeina');
  });

  it('shows the movement row as in progress, without a standing', async () => {
    const root = await render();
    const movement = root.querySelector('app-movement-row');
    expect(movement?.textContent).toContain('In corso');
    expect(movement?.textContent).toContain('1.240');
    expect(movement?.querySelector('app-standing-badge')).toBeNull();
    expect(movement?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1240');
  });

  it('shows the steps goal chosen in settings', async () => {
    const root = await render();
    await TestBed.inject(SettingsService).update({ stepsGoal: 10000 });
    root.fixture.detectChanges();
    expect(root.querySelector('app-movement-row')?.textContent).toContain('su 10.000');
  });

  it('has one Registra button, which opens the sheet on the headache', async () => {
    const root = await render();
    const button = root.querySelector<HTMLButtonElement>('button.register');
    expect(button?.textContent?.trim()).toBe('Registra');
    expect(root.querySelectorAll('.quick-button')).toHaveLength(0);
    button!.click();
    const page = root.fixture.componentInstance as unknown as { sheet: () => string | null };
    expect(page.sheet()).toBe('headache');
  });

  it('opens the other entries from the Registra sheet', async () => {
    const root = await render();
    const page = root.fixture.componentInstance as unknown as { open: (kind: string) => void; sheet: () => string | null };
    for (const kind of ['caffeine', 'alcohol', 'note']) {
      page.open(kind);
      expect(page.sheet()).toBe(kind);
    }
  });

  it('links the ring button to settings with an accessible name', async () => {
    const root = await render();
    const link = root.querySelector('.ring-button');
    expect(link?.getAttribute('aria-label')).toBe('Anello e impostazioni, batteria 62%');
  });

  it('shows a ring that fills up to the battery level while charging', async () => {
    const root = await render();
    expect(root.querySelector('.charge')).toBeNull();
    TestBed.inject(RingSyncService).charging.set(true);
    root.fixture.detectChanges();
    const link = root.querySelector('.ring-button');
    expect(link?.getAttribute('aria-label')).toBe('Anello e impostazioni, batteria 62%, in carica');
    expect(root.querySelector('.charging-label')?.textContent).toBe('in carica');
    const level = root.querySelector<SVGCircleElement>('.charge-level');
    const full = 2 * Math.PI * 8.8;
    expect(Number(level?.getAttribute('stroke-dasharray'))).toBeCloseTo(full);
    expect(parseFloat(level?.style.strokeDashoffset ?? '')).toBeCloseTo(full * 0.38, 1);
    expect(root.querySelector('.ring-dot')).toBeNull();
  });

  it('leaves the body of last night, the heart rate, the temperature and the tools to Sonno and Corpo', async () => {
    const root = await render();
    TestBed.inject(OggiDataService).tick(new Date('2026-11-22T14:00:00Z'));
    root.fixture.detectChanges();
    expect(root.querySelector('#stanotte')).toBeNull();
    expect(root.querySelector('app-heart-today')).toBeNull();
    expect(root.querySelector('a[href="/temperatura"]')).toBeNull();
    expect(root.querySelector('a[href="/misura"]')).toBeNull();
    expect(root.querySelector('a[href^="/sessione"]')).toBeNull();
  });

  it('is replaced by the episode in progress while a headache is open', async () => {
    const root = await render(true);
    expect(root.querySelector('app-episode-view .episode')).not.toBeNull();
    expect(root.querySelector('.indices')).toBeNull();
    expect(root.querySelector('.register')).toBeNull();
  });

  it('shows the normal screen when no headache is open', async () => {
    const root = await render();
    expect(root.querySelector('app-episode-view .episode')).toBeNull();
    expect(root.querySelector('.indices')).not.toBeNull();
  });

  it('always shows the medical disclaimer', async () => {
    const root = await render();
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  describe('plugin rows', () => {
    const view = (
      id: string,
      name: string,
      cadence: 'daily' | 'weekly' | undefined,
      headline: unknown,
      cards: unknown[] = [{ type: 'score', title: 'Rischio', value: 20, zone: 'ottimo', caption: null }],
    ): PluginView => ({
      manifest: { id, name, description: '', version: '1', requires: [], config: [], ...(cadence ? { cadence } : {}) },
      enabled: true,
      config: {},
      result: { cards, insights: [], headline },
    });

    it('shows no section when no plugin has anything to say', async () => {
      const root = await render();
      expect(root.querySelector('#per-oggi')).toBeNull();
    });

    it('shows one row per daily plugin with its headline, before the disclaimer, and opens its page', async () => {
      const root = await render();
      TestBed.inject(PluginsService).views.set([
        view('migraine', 'Emicrania', 'daily', { value: 'Rischio alto', tone: 'attenzione' }),
        view('caffeine-window', 'Finestra caffeina', 'daily', { value: '08:30 – 15:00', tone: null }),
        view('social-jetlag', 'Jet lag sociale', 'weekly', { value: '1 h 10 più tardi', tone: null }),
      ]);
      root.fixture.detectChanges();
      const rows = Array.from(root.querySelectorAll('.plugin-row'));
      expect(rows.map((r) => r.querySelector('.plugin-title')?.textContent)).toEqual(['Emicrania', 'Finestra caffeina']);
      expect(rows.map((r) => r.querySelector('.plugin-value')?.textContent?.trim())).toEqual(['Rischio alto', '08:30 – 15:00']);
      expect(rows[0].querySelector('.plugin-value')?.getAttribute('data-tone')).toBe('attenzione');
      expect(rows[0].querySelector('.plugin-value svg')).not.toBeNull();
      expect(rows[1].querySelector('.plugin-value svg')).toBeNull();
      expect(rows[0].querySelector('a.plugin-link')?.getAttribute('href')).toBe('/plugin/migraine');
      expect(rows[0].querySelector('a.plugin-link')?.getAttribute('aria-label')).toBe('Emicrania: Rischio alto');
      expect(rows[0].querySelector('app-info a')?.getAttribute('href')).toBe('/guida/emicrania');
      expect(root.querySelectorAll('app-plugin-card')).toHaveLength(0);
      const section = root.querySelector('#per-oggi')!.closest('section')!;
      expect(section.compareDocumentPosition(root.querySelector('.disclaimer')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps a plugin from an older server, without cadence or headline, as a row with only its name', async () => {
      const root = await render();
      TestBed.inject(PluginsService).views.set([view('vitamin-d', 'Vitamina D', undefined, undefined)]);
      root.fixture.detectChanges();
      expect(root.querySelector('.plugin-title')?.textContent).toBe('Vitamina D');
      expect(root.querySelector('.plugin-value')).toBeNull();
      expect(root.querySelector('a.plugin-link')?.getAttribute('aria-label')).toBe('Vitamina D: apri i dettagli');
    });

    it('hides the plugin when it is turned off on this phone', async () => {
      const root = await render();
      TestBed.inject(PluginsService).views.set([view('weekly-report', 'Report settimanale', 'daily', null)]);
      await TestBed.inject(SettingsService).setPlugin('weekly-report', false);
      root.fixture.detectChanges();
      expect(root.querySelector('#per-oggi')).toBeNull();
    });
  });
});

describe('OggiPage quick entries', () => {
  const clock = new FakeClock(new Date(2026, 10, 3, 15, 10));

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [OggiPage],
      providers: [provideRouter([]), ...provideDiaryTesting(new InMemoryHeadacheRepository(), clock)],
    }).compileComponents();
    const fixture = TestBed.createComponent(OggiPage);
    fixture.detectChanges();
    // L'handler vive nella pagina: lo si chiama come farebbe lo sheet.
    const page = fixture.componentInstance as unknown as Record<string, (arg?: unknown) => Promise<void>>;
    return { fixture, root: fixture.nativeElement as HTMLElement, page, journal: TestBed.inject(JournalService) };
  }

  it('records a coffee and confirms it, with «Annulla»', async () => {
    const { fixture, root, page, journal } = await setup();
    await page['addCaffeine']({ code: 'coffee', at: clock.now() });
    fixture.detectChanges();

    expect(journal.entries()).toHaveLength(1);
    expect(root.querySelector('.undo')?.textContent).toContain('Caffeina registrata: 1 caffè');
  });

  it('«Annulla» removes the entry just recorded', async () => {
    const { fixture, root, page, journal } = await setup();
    await page['addAlcohol']({ code: 'wine', at: clock.now() });
    fixture.detectChanges();
    expect(root.querySelector('.undo')?.textContent).toContain('Alcol registrato: 1 bicchiere di vino');

    root.querySelector<HTMLButtonElement>('.undo button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(journal.entries()).toHaveLength(0);
    expect(root.querySelector('.undo')).toBeNull();
  });

  it('records a note, and shows no confirmation for an empty one', async () => {
    const { fixture, root, page, journal } = await setup();
    await page['addNote']({ text: '   ', at: clock.now() });
    fixture.detectChanges();
    expect(journal.entries()).toHaveLength(0);
    expect(root.querySelector('.undo')).toBeNull();

    await page['addNote']({ text: 'dormito male', at: clock.now() });
    fixture.detectChanges();
    expect(journal.entries()).toHaveLength(1);
    expect(root.querySelector('.undo')?.textContent).toContain('Nota registrata');
  });
});

describe('formatting', () => {
  it('uses a dot as thousands separator, also with four digits', () => {
    expect(formatThousands(1240)).toBe('1.240');
    expect(formatThousands(8000)).toBe('8.000');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(12400)).toBe('12.400');
  });

  it('writes the day in Italian with a capital letter', () => {
    expect(formatDay(new Date('2026-11-03T08:00:00+01:00'))).toBe('Martedì 3 novembre');
  });
});
