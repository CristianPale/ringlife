import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertEvent } from './alerts.model';
import { AlertsService, ServiceAlert } from './alerts.service';
import { AvvisiPage } from './avvisi.page';

describe('AvvisiPage', () => {
  function event(id: string, day: string, level: 'attenzione' | 'alto', seenAt: number | null = null): AlertEvent {
    return { id, rule: 'hrv', day, level, title: `Titolo ${id}`, body: `Testo ${id}`, route: '/indici/recupero', createdAt: 1, deliverAfter: null, seenAt };
  }

  async function render(events: AlertEvent[], service: ServiceAlert[] = []) {
    const markAllSeen = vi.fn(async () => undefined);
    await TestBed.configureTestingModule({
      imports: [AvvisiPage],
      providers: [provideRouter([]), { provide: AlertsService, useValue: { events: signal(events), service: signal(service), markAllSeen } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AvvisiPage);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, markAllSeen };
  }

  it('shows the service alerts first, then the alerts by day, newest first, and marks them seen', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
    const { root, markAllSeen } = await render(
      [event('a', '2026-11-01', 'attenzione', 5), event('b', today, 'alto')],
      [{ id: 'queue-stuck', title: "Dati dell'anello non inviati da 3 giorni", body: 'Restano sul telefono.', route: '/impostazioni/server' }],
    );
    const titles = Array.from(root.querySelectorAll('.row .title')).map((t) => t.textContent?.trim());
    expect(titles).toEqual(["Dati dell'anello non inviati da 3 giorni", 'Titolo b', 'Titolo a']);
    expect(Array.from(root.querySelectorAll('h2.day')).map((h) => h.textContent)).toEqual(['Oggi', expect.any(String)]);
    const b = root.querySelector('.row[data-level="alto"]')!;
    expect(b.classList).toContain('unseen');
    expect(b.querySelector('svg')).not.toBeNull();
    expect(b.getAttribute('href')).toBe('/indici/recupero');
    expect(root.querySelector('a.settings')?.getAttribute('href')).toBe('/impostazioni/notifiche');
    expect(root.textContent).toContain('non è un dispositivo medico');
    expect(markAllSeen).toHaveBeenCalledOnce();
  });

  it('says when there is nothing', async () => {
    const { root } = await render([]);
    expect(root.querySelector('.empty')?.textContent).toContain('Nessun avviso');
  });
});
