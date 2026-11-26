import { ComponentRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RingSourceProvider } from '../ring/ring-source.provider';
import { RingSyncService } from '../ring/ring-sync.service';
import { SettingsService } from '../settings/settings.service';
import { LiveSessionService } from './live-session.service';
import { SessionPage } from './session.page';

describe('SessionPage', () => {
  async function render(mode: string, birthYear: number | null = null) {
    let listener: (bpm: number | null) => void = () => undefined;
    const source = {
      startLiveHeartRate: vi.fn(async (l: (bpm: number | null) => void) => {
        listener = l;
        return { stop: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) };
      }),
    };
    await TestBed.configureTestingModule({
      imports: [SessionPage],
      providers: [
        provideRouter([]),
        { provide: RingSourceProvider, useValue: { current: signal(source) } },
        { provide: RingSyncService, useValue: { busy: signal(false) } },
      ],
    }).compileComponents();
    if (birthYear !== null) {
      await TestBed.inject(SettingsService).updateProfile({ birthYear });
    }
    const fixture = TestBed.createComponent(SessionPage);
    (fixture.componentRef as ComponentRef<SessionPage>).setInput('mode', mode);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const click = (text: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === text)!
        .click();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    };
    return { root, fixture, click, settle, send: (v: number | null) => listener(v), source };
  }

  it('reads the old address of the heart-rate monitoring as a training', async () => {
    const { root } = await render('battito');
    expect(root.querySelector('h1')?.textContent).toContain('Allenamento');
  });

  it('asks for the activity, and for a target zone only with the birth year', async () => {
    const without = await render('allenamento');
    expect(Array.from(without.root.querySelectorAll('app-chip-group')).map((g) => g.querySelector('[role=group]')?.getAttribute('aria-label'))).toEqual([
      'Attività',
    ]);
    expect(without.root.textContent).toContain("serve l'anno di nascita");
  });

  it('starts with the chosen activity and target zone, and says when the heart rate is above it', async () => {
    const year = new Date().getFullYear() - 40;
    // Battito massimo stimato a 40 anni: 208 − 28 = 180. Zona 3 da 126 a 144.
    const { root, click, settle, send, fixture } = await render('allenamento', year);
    click('Corsa');
    fixture.detectChanges();
    click('3');
    fixture.detectChanges();
    expect(root.textContent).toContain('da 126 a 144 battiti al minuto');
    click('Inizia');
    await settle();
    const live = TestBed.inject(LiveSessionService);
    expect(live.options()).toEqual({ activity: 'corsa', targetZone: 3 });
    send(150);
    fixture.detectChanges();
    const target = root.querySelector('.target')!;
    expect(target.textContent?.trim()).toBe('Sopra la zona obiettivo');
    expect(target.getAttribute('data-tone')).toBe('peggio');
    send(130);
    fixture.detectChanges();
    expect(root.querySelector('.target')?.textContent?.trim()).toBe('Nella zona obiettivo');
    expect(root.querySelector('.target')?.getAttribute('data-tone')).toBeNull();

    click('Pausa');
    await settle();
    expect(root.querySelector('.paused')?.textContent).toBe('In pausa');
    click('Riprendi');
    await settle();
    expect(live.status()).toBe('live');

    click('Fine');
    await settle();
    expect(root.querySelector('h2')?.textContent).toBe('Recupero del battito');
    click('Salta');
    await settle();
    expect(root.textContent).toContain('Riepilogo');
    expect(root.textContent).toContain('Corsa');
    expect(root.textContent).toContain('Recupero del battito non misurato.');
  });
});
