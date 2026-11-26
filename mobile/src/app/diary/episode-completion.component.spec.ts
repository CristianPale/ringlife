import { TestBed } from '@angular/core/testing';
import { EpisodeCompletionComponent } from './episode-completion.component';
import { HeadacheService } from './headache.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('EpisodeCompletionComponent', () => {
  let service: HeadacheService;
  let clock: FakeClock;

  async function render(withMedication: boolean) {
    clock = new FakeClock(new Date(2026, 10, 3, 7, 44));
    TestBed.configureTestingModule({ providers: provideDiaryTesting(new InMemoryHeadacheRepository(), clock) });
    service = TestBed.inject(HeadacheService);
    await service.init();
    await service.start(6, clock.now());
    clock.advanceMinutes(14);
    if (withMedication) {
      await service.addMedication();
    }
    clock.advanceMinutes(58);
    await service.finish();

    const fixture = TestBed.createComponent(EpisodeCompletionComponent);
    fixture.componentRef.setInput('episode', service.pendingCompletion());
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  function chip(root: HTMLElement, group: string, label: string): HTMLButtonElement {
    const buttons = root.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`);
    return Array.from(buttons).find((b) => b.textContent?.trim() === label)!;
  }

  it('summarises the episode', async () => {
    const { root } = await render(true);
    expect(root.querySelector('h2')?.textContent).toContain('stamattina');
    expect(root.querySelector('.summary')?.textContent).toBe('07:44–08:56 · intensità massima 6 · farmaco alle 07:58');
  });

  it('asks about the medication only when one was taken', async () => {
    expect((await render(true)).root.textContent).toContain('Il farmaco ha aiutato?');
    TestBed.resetTestingModule();
    expect((await render(false)).root.textContent).not.toContain('Il farmaco ha aiutato?');
  });

  it('saves the chosen details', async () => {
    const { fixture, root } = await render(true);
    const press = (group: string, label: string) => {
      chip(root, group, label).click();
      fixture.detectChanges();
    };
    press('Sintomi', 'Fotofobia');
    press('Sintomi', 'Nausea');
    press('Dove', 'Destra');
    press("Il farmaco ha aiutato?", "Un po'");
    press('Possibili cause', 'Poco sonno');
    press('Possibili cause', 'Meteo');
    const note = root.querySelector<HTMLInputElement>('#note')!;
    note.value = 'dopo cena';
    note.dispatchEvent(new Event('input'));

    root.querySelector<HTMLButtonElement>('.save')!.click();
    await fixture.whenStable();

    const saved = service.episodes()[0];
    expect(saved.details).toEqual({
      symptoms: ['photophobia', 'nausea'],
      location: 'right',
      medicationHelp: 'a_little',
      causes: ['little_sleep', 'weather'],
      notes: 'dopo cena',
    });
    expect(service.pendingCompletion()).toBeNull();
  });

  it('allows a single location and lets the user clear it', async () => {
    const { fixture, root } = await render(false);
    chip(root, 'Dove', 'Sinistra').click();
    fixture.detectChanges();
    chip(root, 'Dove', 'Nuca').click();
    fixture.detectChanges();
    expect(chip(root, 'Dove', 'Sinistra').getAttribute('aria-pressed')).toBe('false');
    expect(chip(root, 'Dove', 'Nuca').getAttribute('aria-pressed')).toBe('true');
  });

  it('skip closes the request without adding anything', async () => {
    const { fixture, root } = await render(true);
    chip(root, 'Sintomi', 'Aura').click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.skip')!.click();
    await fixture.whenStable();

    expect(service.pendingCompletion()).toBeNull();
    expect(service.episodes()[0].details.symptoms).toEqual([]);
  });

  it('drops a medication answer if no medication was taken', async () => {
    const { fixture, root } = await render(false);
    root.querySelector<HTMLButtonElement>('.save')!.click();
    await fixture.whenStable();
    expect(service.episodes()[0].details.medicationHelp).toBeNull();
  });
});
