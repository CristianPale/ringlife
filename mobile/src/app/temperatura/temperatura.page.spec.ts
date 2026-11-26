import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RingSyncService } from '../ring/ring-sync.service';
import { TemperatureLogService } from '../ring/temperature-log.service';
import { SettingsService } from '../settings/settings.service';
import { TemperaturaPage } from './temperatura.page';

describe('TemperaturaPage', () => {
  async function render(setup?: () => Promise<void>) {
    await TestBed.configureTestingModule({
      imports: [TemperaturaPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    await setup?.();
    const fixture = TestBed.createComponent(TemperaturaPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('says there is no reading yet, and how to turn the measure on when it is off', async () => {
    const root = await render(() => TestBed.inject(SettingsService).updateRing({ temperature: false }));
    expect(root.querySelector('.eyebrow')?.textContent).toBe('Nessuna misura ancora');
    expect(root.textContent).toContain('Accendila in Impostazioni › Anello');
    expect(root.textContent).toContain('Per la febbre usa un termometro');
  });

  it('shows the last reading, the readings of today and the lowest and highest', async () => {
    const now = Date.now();
    const root = await render(() =>
      TestBed.inject(TemperatureLogService).add(
        [
          { metric: 'TEMP', ts: now - 60_000, value: 36.4 },
          { metric: 'TEMP', ts: now - 30 * 60_000 - 60_000, value: 36.1 },
        ],
        now,
      ),
    );
    expect(root.querySelector('.number')?.textContent).toBe('36,4');
    expect(root.querySelector('.when')?.textContent).toMatch(/^(Oggi|Ieri) alle \d\d:\d\d$/);
    expect(root.querySelector('.read button')?.textContent?.trim()).toBe('Misura ora');
  });

  it('measures on demand and says the value, or why it failed', async () => {
    const measure = vi.fn(async () => ({ ok: true as const, kind: 'temperature' as const, value: 36.6, ts: Date.parse('2026-11-23T15:20:00Z') }));
    const root = await render(async () => {
      const ringSync = TestBed.inject(RingSyncService);
      vi.spyOn(ringSync, 'hasRing').mockReturnValue(true);
      vi.spyOn(ringSync, 'measure').mockImplementation(measure);
    });
    const button = root.querySelector<HTMLButtonElement>('.read button')!;
    button.click();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    expect(measure).toHaveBeenCalledWith('temperature');
    expect(root.querySelector('.outcome')?.textContent).toBe('Misurata alle 16:20: 36,6 °C.');

    measure.mockResolvedValueOnce({ ok: false, message: "L'anello non è riuscito a misurare." } as never);
    button.click();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    expect(root.querySelector('.outcome')?.textContent).toBe("L'anello non è riuscito a misurare.");
  });

  it('marks the last reading when it was measured on demand', async () => {
    const now = Date.now();
    const root = await render(() => TestBed.inject(TemperatureLogService).addMeasure(now - 60_000, 36.6));
    expect(root.querySelector('.when')?.textContent).toMatch(/, misura a comando$/);
  });
});
