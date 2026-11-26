import { TestBed } from '@angular/core/testing';
import { EpisodeViewComponent } from './episode-view.component';
import { HeadacheService } from './headache.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('EpisodeViewComponent', () => {
  let clock: FakeClock;
  let service: HeadacheService;

  async function render(intensity = 6) {
    clock = new FakeClock(new Date(2026, 10, 3, 7, 44));
    TestBed.configureTestingModule({ providers: provideDiaryTesting(new InMemoryHeadacheRepository(), clock) });
    service = TestBed.inject(HeadacheService);
    await service.init();
    await service.start(intensity, clock.now());
    clock.advanceMinutes(72);
    const fixture = TestBed.createComponent(EpisodeViewComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('shows duration and start time', async () => {
    const { root } = await render();
    expect(root.querySelector('h1.since')?.textContent).toContain('Cefalea iniziata alle 07:44.');
    expect(root.querySelector('.intensity-value')?.textContent?.trim()).toBe('6');
  });

  it('writes the duration as hours and minutes with its unit, and as minutes under the hour', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('.duration')?.textContent).toBe('1:12');
    expect(root.querySelector('.duration-unit')?.textContent).toBe('ore e minuti');
    clock.advanceMinutes(-30);
    fixture.componentInstance['now'].set(clock.now());
    fixture.detectChanges();
    expect(root.querySelector('.duration')?.textContent).toBe('42');
    expect(root.querySelector('.duration-unit')?.textContent).toBe('minuti');
  });

  it('raises and lowers the intensity', async () => {
    const { fixture, root } = await render();
    root.querySelector<HTMLButtonElement>('[aria-label="Aumenta intensità"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.intensity-value')?.textContent?.trim()).toBe('7');

    root.querySelector<HTMLButtonElement>('[aria-label="Diminuisci intensità"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.intensity-value')?.textContent?.trim()).toBe('6');
  });

  it('disables the stepper at the limits', async () => {
    const { root } = await render(10);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Aumenta intensità"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Diminuisci intensità"]')!.disabled).toBe(false);
  });

  it('notes the time a medication was taken', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('.note')).toBeNull();
    root.querySelector<HTMLButtonElement>('.action')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.note')?.textContent).toContain('Registrato: farmaco alle 08:56');
  });

  it('closes the episode with «È finito»', async () => {
    const { fixture, root } = await render();
    root.querySelector<HTMLButtonElement>('.finish')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.active()).toBeNull();
    expect(root.querySelector('.episode')).toBeNull();
  });

  it('carries the medical disclaimer', async () => {
    const { root } = await render();
    expect(root.querySelector('.disclaimer')?.textContent).toContain('contatta un medico');
    expect(root.querySelector('.disclaimer')?.textContent).toContain('non è un dispositivo medico');
  });
});
