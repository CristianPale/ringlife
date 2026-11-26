import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsService } from '../settings/settings.service';
import { RESPIRO_DATA } from './respiro.data';
import { RespiroData } from './respiro.sample';
import { SONNO_DATA } from './sonno.data';
import { SonnoPage } from './sonno.page';
import { SONNO_SAMPLE } from './sonno.sample';
import { DayView } from '../api/api.model';
import { DaysService } from '../api/days.service';

describe('SonnoPage', () => {
  // I pulsanti «i» della Guida sono collegamenti del router.
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  async function render() {
    await TestBed.configureTestingModule({ imports: [SonnoPage] }).compileComponents();
    const fixture = TestBed.createComponent(SonnoPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('labels the night with lowercase weekdays', async () => {
    const root = await render();
    expect(root.querySelector('.date')?.textContent).toBe('Notte da lunedì a martedì');
  });

  it('shows the score, its zone and how far from the goal', async () => {
    const root = await render();
    expect(root.querySelector('.number')?.textContent).toBe('62');
    expect(root.querySelector('.hero app-zone-badge')?.textContent).toContain('Attenzione');
    expect(root.querySelector('.verdict')?.textContent).toContain('2 h 08 meno del tuo obiettivo di 8 h 00');
  });

  it('follows the sleep goal chosen in settings', async () => {
    await TestBed.configureTestingModule({ imports: [SonnoPage] }).compileComponents();
    await TestBed.inject(SettingsService).update({ sleepGoalMin: 330 });
    const fixture = TestBed.createComponent(SonnoPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.verdict')?.textContent).toContain('Hai raggiunto il tuo obiettivo di 5 h 30');
    expect(root.querySelector('.signals .signal')?.textContent).toContain('Il tuo obiettivo: 5 h 30');
  });

  it('describes the hypnogram for a screen reader', async () => {
    const root = await render();
    const label = root.querySelector('app-hypnogram svg')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('5 h 52 di sonno');
    expect(label).toContain('REM');
  });

  it('compares the four stages with your usual, with duration and unit', async () => {
    const root = await render();
    const rows = Array.from(root.querySelector('#fasi')!.closest('section')!.querySelectorAll('app-measure-row'));
    expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual(['Profondo', 'REM', 'Leggero', 'Sveglio']);
    expect(rows[0].querySelector('.value')?.textContent).toBe('42');
    expect(rows[0].querySelector('.unit')?.textContent).toBe('minuti');
    expect(rows[0].querySelector('.sub')?.textContent).toBe('Meno del solito');
    expect(rows[0].querySelector('.sub')?.getAttribute('data-tone')).toBe('peggio');
  });

  it('spells REM out in the glossary of the stages', async () => {
    const root = await render();
    const stages = Array.from(root.querySelectorAll('.glossary .stage'));
    expect(stages).toHaveLength(4);
    expect(stages[1].textContent).toContain('Rapid Eye Movement');
    expect(stages[0].textContent).toContain('42 min');
  });

  it('opens with a sentence: hours, from when to when, and the stage furthest from your usual', async () => {
    const root = await render();
    expect(root.querySelector('h1.lead')?.textContent).toBe(
      '5 h 52 di sonno, dalle 23:40 alle 06:17. Il sonno profondo è sotto il tuo solito.',
    );
    expect(root.querySelector('h1.lead [data-tone="peggio"]')?.textContent).toBe('sotto il tuo solito');
  });

  it('shows the index with its livella and the usual range, and the zone as secondary information', async () => {
    const root = await render();
    expect(root.querySelector('.hero app-zone-badge')?.textContent).toContain('Attenzione');
    expect(Array.from(root.querySelectorAll('.hero app-livella text')).map((t) => t.textContent)).toEqual(['68', 'il tuo solito', '80']);
  });

  it('shows the body of last night with every unit spelled out', async () => {
    const root = await render();
    const rows = Array.from(root.querySelector('#corpo')!.closest('section')!.querySelectorAll('app-measure-row'));
    expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual([
      'Battito minimo',
      'Variabilità del battito (HRV)',
      'Temperatura',
      'Ossigeno nel sangue (SpO2)',
    ]);
    expect(rows[1].querySelector('.sub')?.textContent).toBe('Più bassa del solito');
    expect(rows.map((r) => r.querySelector('.unit')?.textContent)).toEqual(['battiti al minuto', 'millisecondi', 'gradi', 'per cento']);
  });

  it('draws the last seven nights against the goal', async () => {
    const root = await render();
    expect(root.querySelectorAll('app-debt-bars .bar')).toHaveLength(7);
    expect(root.querySelector('app-debt-bars text.number')?.textContent).toBe('8 h');
  });

  it('lists the seven signals of the index with their weight', async () => {
    const root = await render();
    const rows = Array.from(root.querySelectorAll('.signals .signal'));
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain('pesa il 30%');
    expect(rows[6].textContent).toContain('pesa il 5%');
    expect(rows[6].textContent).toContain('bpm');
  });

  it('shows the regularity with its meaning and a 30-day chart', async () => {
    const root = await render();
    expect(root.querySelector('.reg-number')?.textContent).toBe('52');
    expect(root.querySelector('.plain')?.textContent).toContain('Quanto resta costante');
    expect(root.querySelector('app-trend-chart svg')?.getAttribute('aria-label')).toContain('ultimi 30 giorni');
  });

  it('without two weekend nights explains the missing gap in words, not as a value', async () => {
    const data = { ...SONNO_SAMPLE, regularity: { ...SONNO_SAMPLE.regularity, weekendGapMin: null } };
    await TestBed.configureTestingModule({
      imports: [SonnoPage],
      providers: [{ provide: SONNO_DATA, useValue: signal(data) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SonnoPage);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelectorAll('.reg-facts li')[1];
    expect(row.classList).toContain('pending');
    expect(row.querySelector('strong')).toBeNull();
    expect(row.querySelector('.why')?.textContent).toBe('Si calcola quando ci sono almeno 2 notti nel fine settimana.');
  });

  it('shows the weekend gap as a value when there is one, zero included', async () => {
    const root = await render();
    expect(root.querySelectorAll('.reg-facts li')[1].querySelector('strong')?.textContent).toBe('circa 77 min');
    TestBed.resetTestingModule();
    const data = { ...SONNO_SAMPLE, regularity: { ...SONNO_SAMPLE.regularity, weekendGapMin: 0 } };
    await TestBed.configureTestingModule({
      imports: [SonnoPage],
      providers: [provideRouter([]), { provide: SONNO_DATA, useValue: signal(data) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SonnoPage);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelectorAll('.reg-facts li')[1];
    expect(row.querySelector('strong')?.textContent).toBe('circa 0 min');
  });

  it('carries the formula and the health disclaimer', async () => {
    const root = await render();
    expect(root.querySelectorAll('.formula li')).toHaveLength(7);
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  describe('Respiro notturno', () => {
    async function renderWith(data: RespiroData) {
      await TestBed.configureTestingModule({
        imports: [SonnoPage],
        providers: [{ provide: RESPIRO_DATA, useValue: signal(data) }],
      }).compileComponents();
      const fixture = TestBed.createComponent(SonnoPage);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const stable = Array(40).fill(96);
    const night = (value: number, count = 30) => Array(count).fill(value);

    it('shows the sample night as on track, with values and the full name of SpO2', async () => {
      const root = await render();
      const section = root.querySelector('section[aria-labelledby="respiro"]');
      expect(section?.querySelector('.breath')?.getAttribute('data-status')).toBe('ok');
      expect(section?.textContent).toContain('In linea con la tua media');
      expect(section?.textContent).toContain('Saturazione di ossigeno nel sangue (SpO2)');
      expect(section?.textContent).toContain('Valore più basso');
      expect(section?.textContent).toContain('91%');
      expect(section?.querySelector('app-band-chart svg')?.getAttribute('aria-label')).toContain('ultimi 30 giorni');
    });

    it('flags three low nights in a row, as a trend and not a diagnosis', async () => {
      const root = await renderWith({ tonight: night(93), history: [...stable, 93, 93], source: 'esempio' });
      const box = root.querySelector('.breath');
      expect(box?.getAttribute('data-status')).toBe('watch');
      expect(box?.textContent).toContain('Da guardare');
      expect(box?.textContent).toContain('3 notti di fila');
      expect(box?.textContent).toContain('non una diagnosi');
      expect(root.querySelector('section[aria-labelledby="respiro"]')?.textContent).toContain('parlane con un medico');
    });

    it('says there is not enough data instead of guessing', async () => {
      const root = await renderWith({ tonight: night(96, 6), history: stable, source: 'esempio' });
      const section = root.querySelector('section[aria-labelledby="respiro"]');
      expect(section?.querySelector('.breath')?.textContent).toContain('6 misure: ne servono almeno 10');
      expect(section?.textContent).not.toContain('Mediana della notte');
    });

    it("shows the server's evaluation without recomputing it", async () => {
      const root = await renderWith({
        tonight: [],
        history: stable,
        source: 'server',
        result: { status: 'watch', median: 93, min: 90, count: 42, deviation: -2.4, baseline: 96, streak: 3 },
      });
      const box = root.querySelector('.breath');
      expect(box?.getAttribute('data-status')).toBe('watch');
      expect(box?.textContent).toContain('3 notti di fila');
      expect(root.querySelector('section[aria-labelledby="respiro"]')?.textContent).toContain('42');
    });

    it('shows calibration with a short history', async () => {
      const root = await renderWith({ tonight: night(96), history: [96, 96, 96], source: 'esempio' });
      expect(root.querySelector('.breath')?.textContent).toContain('Calibrazione in corso');
    });
  });

  it("says the data are examples until the phone is paired", async () => {
    expect((await render()).querySelector('.sample-note')?.textContent).toContain("Dati d'esempio");
  });

  it('does not call real data examples', async () => {
    await TestBed.configureTestingModule({
      imports: [SonnoPage],
      providers: [{ provide: SONNO_DATA, useValue: signal({ ...SONNO_SAMPLE, source: 'server' as const }) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SonnoPage);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sample-note')).toBeNull();
  });

  describe('going back to past nights', () => {
    /** Una notte sintetica che finisce la mattina di `date`, con l'indice `value`. */
    function night(date: string, value: number): DayView {
      const start = Date.parse(`${date}T00:00:00Z`) - 90 * 60_000;
      const stages = [
        { stage: 'light' as const, start, end: start + 200 * 60_000 },
        { stage: 'deep' as const, start: start + 200 * 60_000, end: start + 300 * 60_000 },
        { stage: 'rem' as const, start: start + 300 * 60_000, end: start + 420 * 60_000 },
      ];
      return {
        day: date,
        scores: { sleep: { value, algoVersion: 'v1', components: [{ id: 'sleep-duration', weight: 1, score: value }] } },
        metrics: {},
        baselines: {},
        features: {},
        sleep: { start, end: start + 420 * 60_000, stages },
      };
    }

    async function renderDays(giorno?: string) {
      const days = signal([night('2026-11-16', 71), night('2026-11-17', 55), night('2026-11-18', 80)]);
      await TestBed.configureTestingModule({
        imports: [SonnoPage],
        providers: [{ provide: DaysService, useValue: { connected: signal(true), days, fetchedAt: signal(null) } }],
      }).compileComponents();
      const fixture = TestBed.createComponent(SonnoPage);
      fixture.componentRef.setInput('giorno', giorno);
      fixture.detectChanges();
      return { fixture, root: fixture.nativeElement as HTMLElement };
    }

    it('opens on the latest night, with arrows to go back', async () => {
      const { root } = await renderDays();
      expect(root.querySelector('app-day-picker .label')?.textContent).toBe('Notte da martedì a mercoledì');
      expect(root.querySelector('.number')?.textContent).toBe('80');
    });

    it('shows the night asked in the address, and moves with the arrows', async () => {
      const { fixture, root } = await renderDays('2026-11-17');
      expect(root.querySelector('app-day-picker .label')?.textContent).toBe('Notte da lunedì a martedì');
      expect(root.querySelector('.number')?.textContent).toBe('55');
      root.querySelector<HTMLButtonElement>('button[aria-label="Giorno precedente"]')!.click();
      fixture.detectChanges();
      expect(root.querySelector('.number')?.textContent).toBe('71');
      root.querySelector<HTMLButtonElement>('.latest')!.click();
      fixture.detectChanges();
      expect(root.querySelector('.number')?.textContent).toBe('80');
    });

    it('ignores a day it cannot show and stays on the latest night', async () => {
      const { root } = await renderDays('2026-10-01');
      expect(root.querySelector('.number')?.textContent).toBe('80');
    });
  });
});
