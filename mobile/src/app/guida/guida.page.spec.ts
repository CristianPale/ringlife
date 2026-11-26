import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GUIDE } from './guide';
import { GuidaPage } from './guida.page';
import { InfoLinkComponent } from './info-link.component';

describe('GuidaPage', () => {
  async function render(topic?: string) {
    await TestBed.configureTestingModule({
      imports: [GuidaPage],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(GuidaPage);
    (fixture.componentRef as ComponentRef<GuidaPage>).setInput('topic', topic);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists every page by group when there is no topic', async () => {
    const root = await render();
    const groups = Array.from(root.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(groups).toEqual([
      'Gli indici',
      "Le misure dell'anello",
      'Il sonno',
      'I plugin',
      "Usare l'app",
    ]);
    expect(root.querySelectorAll('.topic-link')).toHaveLength(Object.keys(GUIDE).length);
    expect(root.querySelector('a[href="/guida/jet-lag-sociale"]')?.textContent).toContain(
      'Jet lag sociale',
    );
  });

  it('shows one page with its sections and links to the related ones', async () => {
    const root = await render('jet-lag-sociale');
    expect(root.querySelector('h1')?.textContent).toBe('Jet lag sociale');
    expect(root.querySelector('.lead')?.textContent).toContain('fine settimana');
    expect(root.textContent).toContain('Come lo calcola RingLife');
    const related = Array.from(root.querySelectorAll('.topic-link')).map((a) =>
      a.getAttribute('href'),
    );
    expect(related).toEqual(['/guida/punto-medio', '/guida/regolarita', '/guida/ritmo-circadiano']);
    expect(root.textContent).toContain('RingLife non è un dispositivo medico');
  });

  it('says when a page does not exist', async () => {
    const root = await render('nessuna');
    expect(root.querySelector('h1')?.textContent).toBe('Pagina non trovata');
    expect(root.querySelector('a[href="/guida"]')).not.toBeNull();
  });
});

describe('InfoLinkComponent', () => {
  it('links to the guide page and names it for screen readers', async () => {
    await TestBed.configureTestingModule({
      imports: [InfoLinkComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(InfoLinkComponent);
    fixture.componentRef.setInput('topic', 'hrv');
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/guida/hrv');
    expect(link.getAttribute('aria-label')).toBe('Guida: Variabilità del battito (HRV)');
  });
});
