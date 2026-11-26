import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { MOVIMENTO_DATA } from './movimento.data';
import { MOVIMENTO_SAMPLE } from './movimento.sample';
import { MovimentoDetailPage } from './movimento-detail.page';

describe('MovimentoDetailPage', () => {
  async function render(setup?: (settings: SettingsService) => Promise<void>) {
    await TestBed.configureTestingModule({
      imports: [MovimentoDetailPage],
      providers: [
        provideRouter([]),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository(DEFAULT_SETTINGS) },
      ],
    }).compileComponents();
    await setup?.(TestBed.inject(SettingsService));
    const fixture = TestBed.createComponent(MovimentoDetailPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows today as in progress, with the steps against the goal', async () => {
    const root = await render();
    expect(root.querySelector('.hero')?.textContent).toContain('in corso');
    expect(root.querySelector('.hero .number')?.textContent).toBe('1.240');
    expect(root.querySelector('.hero')?.textContent).toContain('su 8.000');
    expect(root.querySelector('.hero [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1240');
  });

  it("shows yesterday's index with four signals and their weights", async () => {
    const root = await render();
    expect(root.querySelector('.index')?.textContent).toBe('74');
    expect(root.querySelector('section[aria-labelledby="ieri"] app-zone-badge')?.textContent).toContain('Buono');
    const rows = Array.from(root.querySelectorAll('.signals .signal'));
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('pesa il 40%');
    expect(rows[3].textContent).toContain('pesa il 10%');
  });

  it('does not draw the «your average» mark on goal-based bars', async () => {
    const root = await render();
    expect(root.querySelector('.signals .bar-typical')).toBeNull();
  });

  it('explains the heart-rate zone instead of leaving it as jargon', async () => {
    const root = await render();
    const effort = root.querySelectorAll('.signals .signal')[2];
    expect(effort.textContent).toContain('Minuti con il battito in zona moderata o alta');
    expect(effort.textContent).toContain('camminata veloce');
  });

  it('names the long idle stretches by hour', async () => {
    const root = await render();
    const text = root.querySelector('.stretches')?.textContent ?? '';
    expect(text).toContain('15:00–17:00');
    expect(text).toContain('21:00–23:00');
  });

  it('asks for the profile instead of inventing calories', async () => {
    const root = await render();
    expect(root.querySelector('section[aria-labelledby="calorie"]')?.textContent).toContain('servono anno di nascita');
    expect(root.querySelector('.kcal')).toBeNull();
    expect(root.querySelector('.link')?.getAttribute('href')).toBe('/impostazioni');
  });

  it('shows the calories with their three parts once the profile is complete', async () => {
    const root = await render((settings) =>
      settings.updateProfile({ sex: 'male', birthYear: 1985, heightCm: 178, weightKg: 75 }),
    );
    expect(root.querySelector('.kcal strong')?.textContent).toMatch(/2\.0\d\d|1\.9\d\d|2\.1\d\d/);
    const parts = Array.from(root.querySelectorAll('.parts li')).map((li) => li.textContent ?? '');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('Metabolismo a riposo');
    expect(parts[0]).toContain('anche stando fermo');
    expect(root.querySelector('section[aria-labelledby="calorie"]')?.textContent).toContain('chilocalorie');
    expect(root.querySelector('section[aria-labelledby="calorie"] .link')).toBeNull();
  });

  it('follows the steps goal chosen in settings', async () => {
    const root = await render((settings) => settings.update({ stepsGoal: 12000 }));
    expect(root.querySelector('.hero')?.textContent).toContain('su 12.000');
  });

  it('shows the steps trend with a state in words, and the disclaimer', async () => {
    const root = await render();
    expect(root.querySelector('section[aria-labelledby="andamento"] .state')?.textContent).toMatch(/In fascia|Fuori fascia/);
    expect(root.querySelector('app-band-chart svg')?.getAttribute('aria-label')).toContain('ultimi 30 giorni');
    expect(root.querySelectorAll('.formula li')).toHaveLength(4);
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  it("says the data are examples until the phone is paired", async () => {
    expect((await render()).querySelector('.sample-note')?.textContent).toContain("Dati d'esempio");
  });

  it('shows what the server sent and does not call it an example', async () => {
    await TestBed.configureTestingModule({
      imports: [MovimentoDetailPage],
      providers: [
        provideRouter([]),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository(DEFAULT_SETTINGS) },
        { provide: MOVIMENTO_DATA, useValue: signal({ ...MOVIMENTO_SAMPLE, stepsToday: 4321, source: 'server' as const }) },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MovimentoDetailPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.hero .number')?.textContent).toBe('4.321');
    expect(root.querySelector('.sample-note')).toBeNull();
  });
});
