import { TestBed } from '@angular/core/testing';
import { PluginCardComponent } from './plugin-card.component';
import { PluginAction, PluginCard } from './plugin.model';

function render(card: PluginCard) {
  const fixture = TestBed.createComponent(PluginCardComponent);
  fixture.componentRef.setInput('card', card);
  fixture.detectChanges();
  return { root: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
}

describe('PluginCardComponent', () => {
  it('draws a score with its zone named, not only coloured', () => {
    const { root } = render({ type: 'score', title: 'Sonno', value: 80, zone: 'buono', caption: 'Media dei 7 giorni' });
    expect(root.querySelector('.title')?.textContent).toContain('Sonno');
    expect(root.querySelector('.number')?.textContent).toContain('80');
    expect(root.querySelector('app-zone-badge')?.textContent).toContain('Buono');
    expect(root.querySelector('.caption')?.textContent).toContain('Media dei 7 giorni');
  });

  it('draws a trend as a line with a text alternative, skipping days without data', () => {
    const { root } = render({ type: 'trend', title: 'Passi', points: [1000, null, 3000], unit: 'passi', caption: null });
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Da 1000 a 3000 passi');
    expect(root.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
  });

  it('says there is no data for a trend with only gaps', () => {
    const { root } = render({ type: 'trend', title: 'Passi', points: [null, null], unit: null, caption: null });
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Nessun dato');
  });

  it('draws a list as terms and values', () => {
    const { root } = render({ type: 'list', title: 'Riepilogo', rows: [{ label: 'Giorni', value: '7' }] });
    expect(root.querySelector('dt')?.textContent).toBe('Giorni');
    expect(root.querySelector('dd')?.textContent).toBe('7');
  });

  it('draws a text card with or without a title', () => {
    expect(render({ type: 'text', title: 'Nota', body: 'Un testo' }).root.querySelector('.title')?.textContent).toBe('Nota');
    const { root } = render({ type: 'text', title: null, body: 'Solo testo' });
    expect(root.querySelector('.title')).toBeNull();
    expect(root.querySelector('.body')?.textContent).toBe('Solo testo');
  });

  it('emits the action of an action card and nothing else', () => {
    const { root, component } = render({ type: 'action', label: 'Apri il diario', action: 'open-diary' });
    const actions: PluginAction[] = [];
    component.act.subscribe((a) => actions.push(a));
    root.querySelector<HTMLButtonElement>('button')!.click();
    expect(actions).toEqual(['open-diary']);
  });
});
