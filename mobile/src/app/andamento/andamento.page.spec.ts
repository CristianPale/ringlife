import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ANDAMENTO_DATA } from './andamento.data';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from '../diary/testing';
import { AndamentoPage } from './andamento.page';
import { ANDAMENTO_SAMPLE } from './andamento.sample';
import { SettingsService } from '../settings/settings.service';
import { PluginsService } from '../plugins/plugins.service';

const diary = () =>
  provideDiaryTesting(new InMemoryHeadacheRepository(), new FakeClock(new Date(2026, 10, 3, 8, 0)), new InMemoryJournalRepository());

describe('AndamentoPage', () => {
  // I pulsanti «i» della Guida sono collegamenti del router.
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  async function render() {
    await TestBed.configureTestingModule({ imports: [AndamentoPage], providers: diary() }).compileComponents();
    const fixture = TestBed.createComponent(AndamentoPage);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  function choose(root: HTMLElement & { fixture: { detectChanges(): void } }, text: string) {
    Array.from(root.querySelectorAll<HTMLButtonElement>('app-chip-group .chip'))
      .find((b) => b.textContent?.includes(text))
      ?.click();
    root.fixture.detectChanges();
  }

  it('starts on 30 days with four comparison cards', async () => {
    const root = await render();
    expect(root.querySelector('#fascia')?.textContent).toContain('Ultimi 30 giorni');
    expect(root.querySelector('#confronto')?.textContent).toContain('Gli ultimi 30 giorni contro i 30 precedenti');
    const names = Array.from(root.querySelectorAll('.compare-name')).map((el) => el.textContent?.trim());
    expect(names).toEqual(['Sonno medio', 'Recupero medio', 'Passi al giorno', 'Episodi di cefalea']);
  });

  it('writes every change in words, not only with an arrow', async () => {
    const root = await render();
    const deltas = Array.from(root.querySelectorAll('.compare-delta')).map((el) => el.textContent?.trim() ?? '');
    expect(deltas).toHaveLength(4);
    for (const delta of deltas) {
      expect(delta).toMatch(/in più|in meno|come il periodo precedente/);
    }
  });

  it('switches to the week with its own wording', async () => {
    const root = await render();
    choose(root, '7 giorni');
    expect(root.querySelector('#confronto')?.textContent).toContain('Questa settimana contro la precedente');
    expect(root.querySelector('#fascia')?.textContent).toContain('Ultimi 7 giorni');
    expect(root.querySelector('app-band-chart svg')?.getAttribute('aria-label')).toContain('ultimi 7 giorni');
  });

  it('can compare 90 days with the previous 90', async () => {
    const root = await render();
    choose(root, '90 giorni');
    expect(root.querySelectorAll('.compare-card')).toHaveLength(4);
  });

  it('shows the four signals with units and meaning, HRV spelled out', async () => {
    const root = await render();
    const titles = Array.from(root.querySelectorAll('.chart-title')).map((el) => el.textContent ?? '');
    expect(titles[0]).toContain('HRV notturna');
    expect(titles[0]).toContain('Variabilità della frequenza cardiaca');
    expect(root.textContent).toContain('43 ms');
    expect(root.textContent).toContain('56 bpm');
    expect(root.textContent).toContain('5 h 52');
    expect(root.textContent).toContain('millisecondi (ms)');
    expect(root.textContent).toContain('battiti al minuto (bpm)');
  });

  it('says in words whether the latest day is inside the band', async () => {
    const root = await render();
    const states = Array.from(root.querySelectorAll('.chart-state')).map((el) => el.textContent?.trim() ?? '');
    expect(states).toHaveLength(4);
    for (const state of states) {
      expect(state).toMatch(/In fascia|Fuori fascia/);
    }
  });

  it('offers a day by day table for every chart', async () => {
    const root = await render();
    const tables = root.querySelectorAll('.days table');
    expect(tables).toHaveLength(4);
    expect(tables[0].querySelectorAll('tbody tr')).toHaveLength(30);
    expect(tables[0].querySelector('tbody th')?.textContent).toContain('3 nov');
  });

  it('shows yesterday by hour with the active hours counted', async () => {
    const root = await render();
    const section = root.querySelector('section[aria-labelledby="ieri"]');
    expect(section?.textContent).toContain('5.470 passi');
    expect(section?.textContent).toContain('11 ore attive su 24');
    expect(section?.querySelector('app-hourly-steps svg')?.getAttribute('aria-label')).toContain('11 ore');
  });

  it('carries the health disclaimer', async () => {
    const root = await render();
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  it('says the data are examples until the phone is paired', async () => {
    expect((await render()).querySelector('.sample-note')?.textContent).toContain("Dati d'esempio");
  });

  it('asks for the birth year before estimating the cardio age', async () => {
    const root = await render();
    const section = root.querySelector('section[aria-labelledby="cuore"]');
    expect(section?.textContent).toContain('Età cardio');
    expect(section?.textContent).toContain("serve l'anno di nascita");
  });

  it('shows the cardio age, the VO2max spelled out and the values it comes from', async () => {
    const data = { ...ANDAMENTO_SAMPLE, restingHrRecent: Array(14).fill(55), today: new Date('2026-11-18T08:00:00'), source: 'server' as const };
    await TestBed.configureTestingModule({
      imports: [AndamentoPage],
      providers: [...diary(), { provide: ANDAMENTO_DATA, useValue: signal(data) }],
    }).compileComponents();
    await TestBed.inject(SettingsService).updateProfile({ birthYear: 1986, sex: 'male' });
    const fixture = TestBed.createComponent(AndamentoPage);
    fixture.detectChanges();
    const section = (fixture.nativeElement as HTMLElement).querySelector('section[aria-labelledby="cuore"]')!;
    expect(section.querySelector('.chart-value')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('21 anni · 19 anni meno della tua età');
    expect(section.textContent).toContain('Consumo massimo di ossigeno (VO2max)');
    expect(section.textContent).toContain('50,1 ml/kg/min');
    expect(section.textContent).toContain('mediana di 14 notti');
    expect(section.textContent).toContain('180 bpm');
    expect(section.textContent).toContain('non un test da sforzo');
  });

  it('says «at least» when the cardio age is at the edge of the table', async () => {
    const data = { ...ANDAMENTO_SAMPLE, restingHrRecent: Array(14).fill(45), today: new Date('2026-11-18T08:00:00'), source: 'server' as const };
    await TestBed.configureTestingModule({
      imports: [AndamentoPage],
      providers: [...diary(), { provide: ANDAMENTO_DATA, useValue: signal(data) }],
    }).compileComponents();
    await TestBed.inject(SettingsService).updateProfile({ birthYear: 1976, sex: 'male' });
    const fixture = TestBed.createComponent(AndamentoPage);
    fixture.detectChanges();
    const value = (fixture.nativeElement as HTMLElement).querySelector('section[aria-labelledby="cuore"] .chart-value');
    expect(value?.textContent?.replace(/\s+/g, ' ').trim()).toBe('20 anni o meno · almeno 30 anni meno della tua età');
  });

  it('draws only the series the server has, and does not call real data examples', async () => {
    const data = { ...ANDAMENTO_SAMPLE, hrv: [], source: 'server' as const };
    await TestBed.configureTestingModule({
      imports: [AndamentoPage],
      providers: [...diary(), { provide: ANDAMENTO_DATA, useValue: signal(data) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AndamentoPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const titles = Array.from(root.querySelectorAll('.chart-title')).map((el) => el.textContent ?? '');
    expect(titles.join('|')).not.toContain('HRV');
    expect(titles.join('|')).toContain('Battito a riposo');
    expect(root.querySelector('.sample-note')).toBeNull();
  });

  it('shows the weekly plugins in «Le tue settimane», with their cards and the way to their page', async () => {
    const root = await render();
    expect(root.querySelector('#settimane')).toBeNull();
    TestBed.inject(PluginsService).views.set([
      {
        manifest: { id: 'social-jetlag', name: 'Jet lag sociale', description: '', version: '1', requires: [], config: [], cadence: 'weekly' },
        enabled: true,
        config: {},
        result: {
          cards: [
            { type: 'list', title: 'Jet lag sociale', rows: [{ label: 'Differenza', value: '1 h 10 più tardi' }] },
            { type: 'action', label: 'Apri il diario', action: 'open-diary' },
          ],
          insights: [],
          headline: { value: '1 h 10 più tardi', tone: null },
        },
      },
      {
        manifest: { id: 'migraine', name: 'Emicrania', description: '', version: '3', requires: [], config: [], cadence: 'daily' },
        enabled: true,
        config: {},
        result: { cards: [{ type: 'text', title: null, body: 'x' }], insights: [] },
      },
    ]);
    root.fixture.detectChanges();
    const section = root.querySelector('#settimane')!.closest('section')!;
    expect(Array.from(section.querySelectorAll('.plugin-name')).map((h) => h.textContent?.trim())).toEqual(['Jet lag sociale']);
    expect(section.querySelectorAll('app-plugin-card')).toHaveLength(1);
    expect(section.querySelector('a.plugin-details')?.getAttribute('href')).toBe('/plugin/social-jetlag');
    expect(section.querySelector('.plugin-name app-info a')?.getAttribute('href')).toBe('/guida/jet-lag-sociale');
  });
});
