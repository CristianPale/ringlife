import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { STRESS_DATA } from './stress.data';
import { StressData } from './stress.model';
import { STRESS_SAMPLE } from './stress.sample';
import { StressDetailPage } from './stress-detail.page';

describe('StressDetailPage', () => {
  async function render(data: StressData = STRESS_SAMPLE) {
    await TestBed.configureTestingModule({
      imports: [StressDetailPage],
      providers: [provideRouter([]), { provide: STRESS_DATA, useValue: signal(data) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StressDetailPage);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  it('says there is no data yet, and shows no example numbers, when the server has none', async () => {
    await TestBed.configureTestingModule({
      imports: [StressDetailPage],
      providers: [provideRouter([]), { provide: STRESS_DATA, useValue: signal(null) }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StressDetailPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Nessun dato ancora');
    expect(root.querySelector('.number')).toBeNull();
  });

  it('shows the score, its zone, the day and says that higher is calmer', async () => {
    const root = await render();
    expect(root.querySelector('.number')?.textContent).toBe('74');
    expect(root.querySelector('.hero app-zone-badge')?.textContent).toContain('Buono');
    expect(root.querySelector('.eyebrow')?.textContent).toContain('Giornata di lunedì 2 novembre');
    expect(root.querySelector('.verdict')?.textContent).toBe('Giornata nella norma');
    expect(root.querySelector('.hero')?.textContent).toContain('più la giornata è stata tranquilla');
  });

  it('lists the two signals with their weight', async () => {
    const root = await render();
    const rows = Array.from(root.querySelectorAll('.signal'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Tempo in stress alto');
    expect(rows[0].textContent).toContain('pesa il 70%');
    expect(rows[1].textContent).toContain('Recupero serale');
    expect(rows[1].textContent).toContain('pesa il 30%');
  });

  it('describes the hourly chart in words and explains the threshold', async () => {
    const root = await render();
    const label = root.querySelector('app-hourly-stress svg')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('2 ore con stress alto (60 o più) su 16 con misure');
    expect(root.querySelector('#ore')?.parentElement?.textContent).toContain('arrivano a 60 o più');
    expect(root.querySelector('#ore')?.parentElement?.textContent).toContain('Il 10% delle misure di giorno');
  });

  it('marks the high hours', async () => {
    const root = await render();
    expect(root.querySelectorAll('app-hourly-stress .bar.is-high')).toHaveLength(2);
    expect(root.querySelectorAll('app-hourly-stress .bar')).toHaveLength(16);
  });

  it('hides the hourly section when the server has no measures', async () => {
    const root = await render({ ...STRESS_SAMPLE, byHour: Array<null>(24).fill(null), highShare: null, source: 'server' });
    expect(root.querySelector('#ore')).toBeNull();
    expect(root.querySelector('app-hourly-stress')).toBeNull();
  });

  it('says the data are examples until the phone is paired, and not after', async () => {
    expect((await render()).querySelector('.sample-note')?.textContent).toContain("Dati d'esempio");
  });

  it('does not call real data examples', async () => {
    expect((await render({ ...STRESS_SAMPLE, source: 'server' })).querySelector('.sample-note')).toBeNull();
  });

  it('switches the trend between 7, 30 and 90 days', async () => {
    const root = await render();
    const label = () => root.querySelector('app-trend-chart svg')?.getAttribute('aria-label') ?? '';
    expect(label()).toContain('ultimi 30 giorni');
    Array.from(root.querySelectorAll<HTMLButtonElement>('app-chip-group .chip'))
      .find((b) => b.textContent?.includes('7 giorni'))
      ?.click();
    root.fixture.detectChanges();
    expect(label()).toContain('ultimi 7 giorni');
  });

  it('carries the health disclaimer and the formula', async () => {
    const root = await render();
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
    expect(root.querySelector('.formula')?.textContent).toContain('70%');
    expect(root.querySelector('.formula')?.textContent).toContain('30%');
  });
});
