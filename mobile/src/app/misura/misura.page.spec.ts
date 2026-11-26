import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ManualMeasureLogService } from '../ring/manual-measure-log.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { MisuraPage } from './misura.page';

describe('MisuraPage', () => {
  async function render(setup?: () => Promise<void> | void) {
    await TestBed.configureTestingModule({
      imports: [MisuraPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    await setup?.();
    const fixture = TestBed.createComponent(MisuraPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists the five measures with their full names, and the last one taken on demand', async () => {
    const root = await render(() => TestBed.inject(ManualMeasureLogService).record('hrv', Date.now() - 60_000, 48));
    const names = Array.from(root.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(names).toEqual([
      'Battito',
      'Ossigeno nel sangue (SpO2, saturazione)',
      'Variabilità della frequenza cardiaca (HRV)',
      'Stress',
      'Temperatura',
    ]);
    const last = Array.from(root.querySelectorAll('.last')).map((p) => p.textContent);
    expect(last[2]).toMatch(/^Ultima: 48 ms, (oggi|ieri) alle \d\d:\d\d\.$/);
    expect(last[0]).toBe('Nessuna misura a comando ancora.');
    expect(root.textContent).toContain('RingLife non è un dispositivo medico');
  });

  it('measures the chosen one and says the value', async () => {
    const measure = vi.fn(async () => ({ ok: true as const, kind: 'spo2' as const, value: 97, ts: Date.parse('2026-11-23T15:47:00Z') }));
    const root = await render(() => {
      const ringSync = TestBed.inject(RingSyncService);
      vi.spyOn(ringSync, 'hasRing').mockReturnValue(true);
      vi.spyOn(ringSync, 'measure').mockImplementation(measure);
    });
    const buttons = root.querySelectorAll<HTMLButtonElement>('app-measure-control button');
    expect(buttons).toHaveLength(5);
    expect(buttons[1].textContent?.trim()).toBe('Misura');
    buttons[1].click();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    expect(measure).toHaveBeenCalledWith('spo2');
    expect(root.querySelectorAll('.measure')[1].querySelector('.outcome')?.textContent).toBe('Misurata alle 16:47: 97 %.');
  });

  it('keeps the buttons off without a ring', async () => {
    const root = await render(() => {
      vi.spyOn(TestBed.inject(RingSyncService), 'hasRing').mockReturnValue(false);
    });
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('app-measure-control button'));
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});
