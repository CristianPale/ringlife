import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CredentialsRepository } from '../api/credentials.repository';
import { CredentialsService } from '../api/credentials.service';
import { InMemoryCredentialsRepository } from '../api/testing';
import { HeadacheService } from '../diary/headache.service';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from '../diary/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { PluginView } from './plugin.model';
import { PluginPage } from './plugin.page';
import { PluginsService } from './plugins.service';

const view = (id: string, name: string, cards: unknown[], insights: unknown[] = []): PluginView => ({
  manifest: { id, name, description: '', version: '1', requires: [], config: [] },
  enabled: true,
  config: {},
  result: { cards, insights },
});

describe('PluginPage', () => {
  const clock = new FakeClock(new Date(2026, 10, 14, 9, 0));

  async function render(id: string, views: PluginView[] = []) {
    await TestBed.configureTestingModule({
      imports: [PluginPage],
      providers: [
        provideRouter([]),
        ...provideDiaryTesting(new InMemoryHeadacheRepository(), clock, new InMemoryJournalRepository()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    }).compileComponents();
    await TestBed.inject(SettingsService).init();
    await TestBed.inject(CredentialsService).init();
    await TestBed.inject(HeadacheService).init();
    TestBed.inject(PluginsService).views.set(views);
    const fixture = TestBed.createComponent(PluginPage);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  it('shows the name of the plugin as the title and all its cards and comments', async () => {
    const root = await render('weekly-report', [
      view('weekly-report', 'Report settimanale', [{ type: 'score', title: 'Sonno', value: 80, zone: 'buono', caption: null }], [
        { level: 'info', title: 'Sonno: settimana migliore', text: 'La media è 80.' },
      ]),
    ]);
    expect(root.querySelector('h1.title')?.textContent?.trim()).toBe('Report settimanale');
    expect(root.querySelector('h1.title a')?.getAttribute('href')).toBe('/guida/report-settimanale');
    expect(root.querySelectorAll('app-plugin-card')).toHaveLength(2);
  });

  it('keeps the name of the plugin when the server has not answered', async () => {
    expect((await render('migraine')).querySelector('h1.title')?.textContent?.trim()).toBe('Emicrania');
  });

  it('shows only the plugin of its address', async () => {
    const root = await render('circadian', [
      view('weekly-report', 'Report settimanale', [{ type: 'text', title: 'A', body: 'altro plugin' }]),
      view('circadian', 'Ritmo circadiano', [{ type: 'text', title: 'B', body: 'questo plugin' }]),
    ]);
    expect(root.textContent).toContain('questo plugin');
    expect(root.textContent).not.toContain('altro plugin');
  });

  it('says there is no result yet, instead of staying empty, and links the parameters', async () => {
    const root = await render('circadian');
    expect(root.querySelector('.empty')?.textContent).toContain('Nessun risultato');
    expect(root.querySelector('a.settings-link')?.getAttribute('href')).toBe('/impostazioni/plugin');
  });

  it('keeps only the actions it can run: the diary yes, the breathing no', async () => {
    const root = await render('circadian', [
      view('circadian', 'Ritmo circadiano', [
        { type: 'action', label: 'Respira', action: 'open-breathing' },
        { type: 'action', label: 'Apri il diario', action: 'open-diary' },
      ]),
    ]);
    const labels = Array.from(root.querySelectorAll('app-plugin-card button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Apri il diario']);
  });

  it('has no migraine extras on the page of another plugin', async () => {
    const root = await render('circadian', [view('circadian', 'Ritmo circadiano', [{ type: 'text', title: null, body: 'x' }])]);
    expect(root.querySelector('table.calendar')).toBeNull();
    expect(root.querySelector('app-migraine-report')).toBeNull();
  });

  describe('migraine', () => {
    const migraine = view('migraine', 'Emicrania', [{ type: 'score', title: 'Rischio di oggi', value: 60, zone: 'buono', caption: null }]);

    it('shows the month with its weekdays, the report and the model progress', async () => {
      const root = await render('migraine', [migraine]);
      expect(root.querySelector('#mese')?.textContent).toBe('Novembre 2026');
      expect(Array.from(root.querySelectorAll('.calendar thead th')).map((th) => th.textContent)).toEqual([
        'lun',
        'mar',
        'mer',
        'gio',
        'ven',
        'sab',
        'dom',
      ]);
      expect(root.querySelector('app-migraine-report')).not.toBeNull();
      expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
      expect(root.textContent).toContain('0 di 20 cefalee registrate');
    });

    it('marks the days of the episodes in words too, and counts them', async () => {
      const root = await render('migraine', [migraine]);
      const headaches = TestBed.inject(HeadacheService);
      await headaches.start(6, new Date(2026, 10, 3, 6, 20));
      await headaches.addMedication();
      await headaches.finish();
      root.fixture.detectChanges();
      const day3 = Array.from(root.querySelectorAll('.day')).find((d) => d.textContent?.trim().startsWith('3'));
      expect(day3?.getAttribute('data-kind')).toBe('medication');
      expect(day3?.textContent).toContain('cefalea con farmaco');
      expect(root.querySelector('.facts')?.textContent).toContain('Cefalee1');
      expect(root.textContent).toContain('1 di 20 cefalee registrate');
    });

    it('goes back to the previous month and cannot go past the current one', async () => {
      const root = await render('migraine', [migraine]);
      const next = root.querySelector<HTMLButtonElement>('[aria-label="Mese successivo"]')!;
      expect(next.disabled).toBe(true);
      root.querySelector<HTMLButtonElement>('[aria-label="Mese precedente"]')!.click();
      root.fixture.detectChanges();
      expect(root.querySelector('#mese')?.textContent).toBe('Ottobre 2026');
      expect(next.disabled).toBe(false);
      next.click();
      root.fixture.detectChanges();
      expect(root.querySelector('#mese')?.textContent).toBe('Novembre 2026');
    });

    it('states the disclaimer', async () => {
      const root = await render('migraine', [migraine]);
      expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
    });
  });
});
