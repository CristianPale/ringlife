import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { HeartRateLogService } from '../ring/heart-rate-log.service';
import { OggiDataService } from '../oggi/oggi-data.service';
import { SessionHistoryService } from '../session/session-history.service';
import { SettingsService } from '../settings/settings.service';
import { CorpoPage } from './corpo.page';

describe('CorpoPage', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [CorpoPage],
      providers: [provideRouter([]), { provide: PLAIN_STORE, useValue: new InMemoryKeyValueStore() }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CorpoPage);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture });
  }

  it('opens Temperatura and Misura ora, and says when there is no heart rate yet', async () => {
    const root = await render();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Corpo');
    const links = Array.from(root.querySelectorAll('nav.rows a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/temperatura', '/misura']);
    expect(root.textContent).toContain('Nessuna misura del battito ancora');
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });

  it('shows the heart rate the ring measured today, with the last value and the range', async () => {
    const root = await render();
    const now = new Date('2026-11-22T14:00:00Z');
    const min = 60_000;
    await TestBed.inject(HeartRateLogService).add(
      [
        // Ieri sera: non è di oggi.
        { metric: 'HR', ts: Date.parse('2026-11-21T22:00:00Z'), value: 90 },
        { metric: 'HR', ts: now.getTime() - 60 * min, value: 58 },
        { metric: 'HR', ts: now.getTime() - 55 * min, value: 96 },
        { metric: 'HR', ts: now.getTime() - 5 * min, value: 72 },
      ],
      now.getTime(),
    );
    TestBed.inject(OggiDataService).tick(now);
    root.fixture.detectChanges();
    expect(root.querySelector('.heart h2')?.textContent?.trim()).toBe('Battito di oggi');
    expect(root.querySelector('.heart h2 a')?.getAttribute('href')).toBe('/guida/battito-oggi');
    expect(root.querySelector('.heart-value')?.textContent).toBe('72');
    expect(root.querySelector('.heart-unit')?.textContent).toBe('battiti al minuto, alle 14:55');
    expect(root.querySelector('.heart-note')?.textContent).toContain('Oggi da 58 a 96 battiti al minuto.');
  });

  it('starts a training or a breathing session, and shows the minutes per week once there is a training', async () => {
    const root = await render();
    const previews = Array.from(root.querySelectorAll('a.session-preview'));
    expect(previews.map((a) => a.getAttribute('href'))).toEqual(['/sessione/allenamento', '/sessione/respirazione']);
    expect(previews[0].querySelector('.session-name')?.textContent).toBe('Allenamento');
    expect(root.querySelector('app-week-minutes')).toBeNull();

    await TestBed.inject(SessionHistoryService).add('allenamento', Date.now() - 3_600_000, 30 * 60_000, [{ t: 0, bpm: 120 }], {
      activity: 'corsa',
    });
    root.fixture.detectChanges();
    expect(root.querySelector('a.session-preview .session-last')?.textContent).toContain('Corsa, 30 min');
    const bars = Array.from(root.querySelectorAll('app-week-minutes li'));
    expect(bars).toHaveLength(8);
    expect(bars[7].getAttribute('aria-label')).toBe('Questa settimana: 30 minuti');
    expect(root.querySelector('a.session-history')?.getAttribute('href')).toBe('/sessioni');
  });

  it('hides the sessions when the plugin is turned off', async () => {
    const root = await render();
    await TestBed.inject(SettingsService).setPlugin('training', false);
    root.fixture.detectChanges();
    expect(root.querySelector('a.session-preview')).toBeNull();
    expect(root.querySelector('nav.rows')).not.toBeNull();
  });
});
