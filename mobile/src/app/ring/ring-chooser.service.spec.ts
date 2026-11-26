import { TestBed } from '@angular/core/testing';
import { CHOOSE_TIMEOUT_MS } from './ble/capacitor-ring-link';
import { RingChooserComponent } from './ring-chooser.component';
import { RingChooserService, signalText } from './ring-chooser.service';

const RINGS = [
  { id: 'near', name: 'COLMI Ring 2', rssi: -48 },
  { id: 'far', name: 'COLMI Ring 2', rssi: -82 },
];

describe('RingChooserService', () => {
  it('opens the window and answers with the chosen ring', async () => {
    const service = TestBed.inject(RingChooserService);
    const answer = service.choose({ rings: RINGS, replacing: false });
    expect(service.request()?.rings).toEqual(RINGS);
    service.pick('far');
    expect(await answer).toBe('far');
    expect(service.request()).toBeNull();
  });

  it('answers nothing on cancel, on a new question, or after the time limit', async () => {
    vi.useFakeTimers();
    try {
      const service = TestBed.inject(RingChooserService);
      const cancelled = service.choose({ rings: RINGS, replacing: false });
      service.cancel();
      expect(await cancelled).toBeNull();

      const replaced = service.choose({ rings: RINGS, replacing: false });
      const latest = service.choose({ rings: RINGS, replacing: true });
      expect(await replaced).toBeNull();
      expect(service.request()?.replacing).toBe(true);

      await vi.advanceTimersByTimeAsync(CHOOSE_TIMEOUT_MS);
      expect(await latest).toBeNull();
      expect(service.request()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the signal strength in words', () => {
    expect(signalText(-48)).toBe('segnale forte');
    expect(signalText(-70)).toBe('segnale medio');
    expect(signalText(-90)).toBe('segnale debole');
    expect(signalText(null)).toBe('segnale sconosciuto');
  });
});

describe('RingChooserComponent', () => {
  it('lists the rings, nearest first, and picks the one touched', async () => {
    const fixture = TestBed.createComponent(RingChooserComponent);
    const service = TestBed.inject(RingChooserService);
    const answer = service.choose({ rings: RINGS, replacing: false });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h2')?.textContent).toContain('Quale anello è il tuo?');
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button.ring')];
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'COLMI Ring 2 segnale forte, il più vicino',
      'COLMI Ring 2 segnale debole',
    ]);
    buttons[1].click();
    expect(await answer).toBe('far');
  });

  it('asks whether a different ring is yours', () => {
    const fixture = TestBed.createComponent(RingChooserComponent);
    void TestBed.inject(RingChooserService).choose({ rings: [RINGS[0]], replacing: true });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h2')?.textContent).toContain('È il tuo anello?');
    expect(el.textContent).not.toContain('il più vicino');
  });
});
