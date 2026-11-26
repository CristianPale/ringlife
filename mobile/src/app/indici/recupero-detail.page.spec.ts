import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { JournalService } from '../diary/journal.service';
import { provideRouter } from '@angular/router';
import { JournalEntry } from '../diary/journal.model';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from '../diary/testing';
import { RECUPERO_DATA } from './recupero.data';
import { RecuperoData } from './recupero.model';
import { RECUPERO_SAMPLE } from './recupero.sample';
import { RecuperoDetailPage } from './recupero-detail.page';

describe('RecuperoDetailPage', () => {
  async function render(data: RecuperoData = RECUPERO_SAMPLE, journal: JournalEntry[] = []) {
    const clock = new FakeClock(new Date(2026, 10, 3, 8, 0));
    await TestBed.configureTestingModule({
      imports: [RecuperoDetailPage],
      providers: [
        provideRouter([]),
        ...provideDiaryTesting(new InMemoryHeadacheRepository(), clock, new InMemoryJournalRepository(journal)),
        { provide: RECUPERO_DATA, useValue: signal(data) },
      ],
    }).compileComponents();
    await TestBed.inject(JournalService).init();
    const fixture = TestBed.createComponent(RecuperoDetailPage);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  it('shows the score, its zone and the verdict', async () => {
    const root = await render();
    expect(root.querySelector('.number')?.textContent).toBe('64');
    expect(root.querySelector('.hero app-zone-badge')?.textContent).toContain('Attenzione');
    expect(root.querySelector('.verdict')?.textContent).toBe('Vai piano oggi.');
  });

  it('opens with a sentence on where the Recupero stands against your average and what weighs most', async () => {
    const root = await render();
    expect(root.querySelector('h1.lead')?.textContent).toBe(
      'Il recupero di oggi è sotto il tuo solito. Pesa soprattutto la variabilità della frequenza cardiaca (HRV).',
    );
    const toned = root.querySelector('h1.lead [data-tone="peggio"]');
    expect(toned?.textContent).toBe('sotto il tuo solito');
  });

  it('says it is calibrating when there is no average yet', async () => {
    const root = await render({ ...RECUPERO_SAMPLE, indexDeviation: null, indexRange: null });
    expect(root.querySelector('h1.lead')?.textContent).toContain('ancora in calibrazione');
    expect(root.querySelector('.hero app-livella .empty')).not.toBeNull();
  });

  it('without any Recupero yet, says it is calibrating and how many nights are left', async () => {
    const root = await render(null as unknown as RecuperoData);
    const text = root.querySelector('app-no-data')?.textContent ?? '';
    expect(text).toContain('In calibrazione.');
    expect(text).toContain('il primo Recupero arriva dopo 8 notti');
    expect(text).not.toContain('Nessun dato ancora');
  });

  it('draws the usual range under the livella of the score', async () => {
    const root = await render();
    const texts = Array.from(root.querySelectorAll('.hero app-livella text')).map((t) => t.textContent);
    expect(texts).toEqual(['66', 'il tuo solito', '82']);
  });

  it('lists the five signals with their weight and where each stands against your average', async () => {
    const root = await render();
    const rows = Array.from(root.querySelectorAll('.measures app-measure-row'));
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain('HRV');
    // L'HRV di esempio sta sulla tacca (−1,5): ancora «come al solito». Il Sonno (−1,7) è oltre.
    expect(rows[0].querySelector('.sub')?.textContent).toBe('Come al solito, peso 35%');
    expect(rows[3].querySelector('.sub')?.textContent).toBe('Peggio del solito, peso 15%');
    expect(rows[3].querySelector('.sub')?.getAttribute('data-tone')).toBe('peggio');
    expect(rows[4].querySelector('.sub')?.textContent).toContain('peso 10%');
  });

  it('never shows an acronym without its meaning', async () => {
    const root = await render();
    const rows = Array.from(root.querySelectorAll('.measures app-measure-row'));
    expect(rows[0].querySelector('.name')?.textContent).toBe('Variabilità della frequenza cardiaca (HRV)');
    expect(rows[0].querySelector('.unit')?.textContent).toBe('millisecondi');
    expect(rows[1].querySelector('.unit')?.textContent).toBe('battiti al minuto');
    expect(root.querySelector('.formula')?.textContent).toContain('Variabilità della frequenza cardiaca (HRV)');
    const glossary = root.querySelector('.glossary')?.textContent ?? '';
    expect(glossary).toContain('millisecondi (ms)');
    expect(glossary).toContain('battiti al minuto (bpm)');
  });

  it('gives every signal a livella with a text alternative, not only a colour', async () => {
    const root = await render();
    const labels = Array.from(root.querySelectorAll('.measures app-livella svg')).map((svg) => svg.getAttribute('aria-label'));
    expect(labels[0]).toBe('Come al solito, 43 millisecondi');
    expect(labels[3]).toBe('Peggio del solito, 62 su 100');
    expect(labels.every((label) => !!label)).toBe(true);
  });

  it('a temperature far from usual is only higher or lower, never worse', async () => {
    const root = await render({
      ...RECUPERO_SAMPLE,
      contributors: RECUPERO_SAMPLE.contributors.map((c) => (c.id === 'temperatura' ? { ...c, deviation: 2.4 } : c)),
    });
    const sub = root.querySelectorAll('.measures app-measure-row')[2].querySelector('.sub');
    expect(sub?.textContent).toBe('Più alta del solito, peso 15%');
    expect(sub?.getAttribute('data-tone')).toBeNull();
  });

  it('shows 30 days by default, with your usual band, and switches period', async () => {
    const root = await render();
    const chart = () => root.querySelector('app-band-chart svg')?.getAttribute('aria-label') ?? '';
    expect(chart()).toContain('ultimi 30 giorni');
    expect(root.querySelector('app-band-chart .band')).not.toBeNull();

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('app-chip-group .chip'));
    buttons.find((b) => b.textContent?.includes('7 giorni'))?.click();
    root.fixture.detectChanges();
    expect(chart()).toContain('ultimi 7 giorni');

    buttons.find((b) => b.textContent?.includes('90 giorni'))?.click();
    root.fixture.detectChanges();
    expect(chart()).toContain('ultimi 90 giorni');
  });

  it('keeps the period when the active one is tapped again', async () => {
    const root = await render();
    const active = root.querySelector<HTMLButtonElement>('app-chip-group .chip[aria-pressed="true"]');
    active?.click();
    root.fixture.detectChanges();
    expect(root.querySelector('app-band-chart svg')?.getAttribute('aria-label')).toContain('ultimi 30 giorni');
  });

  it('explains the formula and carries the health disclaimer', async () => {
    const root = await render();
    expect(root.querySelector('.formula summary')?.textContent?.trim()).toBe('Come si calcola');
    expect(root.querySelectorAll('.formula li')).toHaveLength(5);
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  describe('Segnali di affaticamento', () => {
    const tired: RecuperoData = { ...RECUPERO_SAMPLE, deviations: { rhr: 1.5, hrv: -1.5, temp: 0 } };

    it('says there is no signal when fewer than two are over the threshold', async () => {
      const root = await render();
      const box = root.querySelector('.strain');
      expect(box?.getAttribute('data-level')).toBe('nessuno');
      expect(box?.textContent).toContain('Nessun segnale di affaticamento');
      expect(box?.textContent).toContain('1 segnale su 3');
      expect(root.querySelectorAll('.strain-row')).toHaveLength(3);
      expect(root.querySelectorAll('.strain-row.is-active')).toHaveLength(1);
    });

    it('recommends rest with two signals, never as a diagnosis', async () => {
      const root = await render(tired);
      const box = root.querySelector('.strain');
      expect(box?.getAttribute('data-level')).toBe('attenzione');
      expect(box?.textContent).toContain('Riposo consigliato oggi');
      expect(root.querySelectorAll('.strain-row.is-active')).toHaveLength(2);
      expect(root.querySelector('#fatica')?.parentElement?.textContent).toContain('Non è una diagnosi');
    });

    it('spells out HRV and states the direction that counts', async () => {
      const root = await render(tired);
      const rows = Array.from(root.querySelectorAll('.strain-row')).map((r) => r.textContent ?? '');
      expect(rows[1]).toContain('Variabilità della frequenza cardiaca');
      expect(rows[1]).toContain('Conta se è più bassa del solito');
      expect(rows[0]).toContain('56 bpm');
    });

    it('names alcohol from the diary as a possible cause', async () => {
      const wine: JournalEntry = {
        id: 'w',
        at: new Date(2026, 10, 2, 21, 30).toISOString(),
        kind: 'alcohol',
        drink: 'wine',
      };
      const root = await render(tired, [wine]);
      expect(root.querySelector('.strain-cause')?.textContent).toContain('alcol');
    });

    it('stays silent about alcohol when none was logged', async () => {
      const root = await render(tired);
      expect(root.querySelector('.strain-cause')).toBeNull();
    });

    it('shows calibration instead of a level without a baseline', async () => {
      const root = await render({ ...RECUPERO_SAMPLE, deviations: { rhr: null, hrv: -1.5, temp: 0 } });
      expect(root.querySelector('.strain')?.textContent).toContain('Calibrazione in corso');
      expect(root.querySelectorAll('.strain-row')).toHaveLength(0);
    });
  });

  it("says the data are examples until the phone is paired", async () => {
    expect((await render()).querySelector('.sample-note')?.textContent).toContain("Dati d'esempio");
  });

  it('does not call real data examples', async () => {
    const root = await render({ ...RECUPERO_SAMPLE, source: 'server' });
    expect(root.querySelector('.sample-note')).toBeNull();
  });
});
