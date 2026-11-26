import { TestBed } from '@angular/core/testing';
import { GiroData } from './giro';
import { GiroCenter, GiroComponent } from './giro.component';

const FULL: GiroData = {
  usual: { startMin: -20, endMin: 420 },
  sleep: { startMin: 48, endMin: 425 },
  caffeine: { startMin: 540, endMin: 870 },
  nowMin: 462,
};
const CENTER: GiroCenter = { label: 'Recupero', value: 64, deviation: -1.9 };

function render(giro: GiroData, center: GiroCenter = CENTER) {
  const fixture = TestBed.createComponent(GiroComponent);
  fixture.componentRef.setInput('giro', giro);
  fixture.componentRef.setInput('center', center);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GiroComponent', () => {
  beforeEach(() => GiroComponent.resetForTests());

  it('draws the usual sleep, last night, the caffeine window and now', () => {
    const root = render(FULL);
    expect(root.querySelector('.usual-arc')?.getAttribute('d')).toBe('M99.63 12.37A96 96 0 0 1 200.73 132.85');
    expect(root.querySelector('.sleep-arc')).not.toBeNull();
    expect(root.querySelector('.caffeine-arc')?.getAttribute('d')).toBe('M175.88 175.88A96 96 0 0 1 49.56 184.16');
    expect(root.querySelectorAll('.tick')).toHaveLength(2);
    expect(root.querySelector('.now')?.getAttribute('cx')).toBe('194.65');
  });

  it('skips what it does not have', () => {
    const root = render({ usual: null, sleep: null, caffeine: null, nowMin: 60 });
    expect(root.querySelector('.usual-arc')).toBeNull();
    expect(root.querySelector('.sleep-arc')).toBeNull();
    expect(root.querySelector('.caffeine-arc')).toBeNull();
    expect(root.querySelectorAll('.tick')).toHaveLength(0);
    expect(root.querySelector('.now')).not.toBeNull();
  });

  it('shows the index at the centre with its livella and standing in words', () => {
    const root = render(FULL);
    expect(root.querySelector('.name')?.textContent).toBe('Recupero, su 100');
    expect(root.querySelector('.value')?.textContent).toBe('64');
    expect(root.querySelector('.bubble')?.getAttribute('cx')).toBe('77.6');
    expect(root.querySelector('.standing')?.textContent).toBe('Peggio del solito');
    expect(root.querySelector('.standing')?.classList.contains('peggio')).toBe(true);
  });

  it('shows an empty tube and says it is calibrating without a deviation', () => {
    const root = render(FULL, { ...CENTER, deviation: null });
    expect(root.querySelector('.bubble')).toBeNull();
    expect(root.querySelector('.standing')?.textContent).toBe('In calibrazione');
  });

  it('describes the whole dial in words for VoiceOver', () => {
    const label = render(FULL).querySelector('svg')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Sonno dalle 00:48 alle 07:05.');
    expect(label).toContain('Adesso sono le 07:42.');
    expect(label).toContain('Recupero 64 su 100, peggio del solito.');
  });

  it('starts the opening animation only when told to, so it can wait for the startup loader', () => {
    const fixture = TestBed.createComponent(GiroComponent);
    fixture.componentRef.setInput('giro', FULL);
    fixture.componentRef.setInput('center', CENTER);
    fixture.componentRef.setInput('play', false);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('play')).toBe(false);
    fixture.componentRef.setInput('play', true);
    fixture.detectChanges();
    expect(host.classList.contains('play')).toBe(true);
    expect(host.classList.contains('wait')).toBe(false);
  });

  it('waits hidden until the go, and only the first dial of the session animates', () => {
    const create = (play: boolean) => {
      const fixture = TestBed.createComponent(GiroComponent);
      fixture.componentRef.setInput('giro', FULL);
      fixture.componentRef.setInput('center', CENTER);
      fixture.componentRef.setInput('play', play);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const first = create(false);
    expect(first.classList.contains('wait')).toBe(true);
    // Un secondo giro (la pagina ricreata) nasce già completo: né attesa né animazione.
    const second = create(true);
    expect(second.classList.contains('wait')).toBe(false);
    expect(second.classList.contains('play')).toBe(false);
  });

  it('drops the play class when the opening is over, so later changes do not replay it', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(GiroComponent);
      fixture.componentRef.setInput('giro', FULL);
      fixture.componentRef.setInput('center', CENTER);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.classList.contains('play')).toBe(true);
      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(host.classList.contains('play')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
