import { TestBed } from '@angular/core/testing';
import { MigraineReportData } from '../api/api.model';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { FileShare } from './file-share';
import { MigraineReportComponent } from './migraine-report.component';

const DATA: MigraineReportData = {
  from: '2026-08-07',
  to: '2026-11-04',
  days: 90,
  summary: { episodes: 2, headacheDays: 2, peakMax: 8, peakAverage: 7, medicationDays: 1, medicationIntakes: 1, averageDurationMin: 60 },
  episodes: [],
  recurrences: [],
};

describe('MigraineReportComponent', () => {
  async function render(paired: boolean) {
    const api = { getMigraineReportData: vi.fn(async () => DATA), getMigraineReportPdf: vi.fn(async () => 'JVBERi0=') };
    const files = {
      save: vi.fn(async () => 'file:///c/r.pdf'),
      share: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [MigraineReportComponent],
      providers: [
        { provide: RingLifeApi, useValue: api },
        { provide: FileShare, useValue: files },
        { provide: CredentialsService, useValue: { paired: () => (paired ? { deviceId: 'd', token: 't' } : null) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MigraineReportComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, root, api, files, settle };
  }

  const button = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  it('says what the report is and that it holds no notes or personal data', async () => {
    const { root } = await render(true);
    expect(root.textContent).toContain('Report per il medico');
    expect(root.textContent).toContain('Non contiene note, nome o altri dati personali');
  });

  it('asks for a server when the phone is not paired, and offers nothing else', async () => {
    const { root } = await render(false);
    expect(root.textContent).toContain('Serve un server collegato');
    expect(root.querySelector('button')).toBeNull();
  });

  it('offers the three periods, ninety days selected', async () => {
    const { root } = await render(true);
    const chips = Array.from(root.querySelectorAll('.chip'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['30 giorni', '90 giorni', '180 giorni']);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('shows the preview first and only then lets the user share', async () => {
    const { root, api, files, settle } = await render(true);
    expect(button(root, 'Condividi PDF')).toBeUndefined();
    button(root, 'Mostra anteprima')!.click();
    await settle();
    expect(api.getMigraineReportData).toHaveBeenCalledWith(90);
    expect(root.querySelector('ul')?.textContent).toContain('2 cefalee in 2 giorni');
    expect(files.share).not.toHaveBeenCalled();

    button(root, 'Condividi PDF')!.click();
    await settle();
    expect(api.getMigraineReportPdf).toHaveBeenCalledWith(90);
    expect(files.share).toHaveBeenCalledOnce();
  });

  it('drops the preview when the period changes, because it was for another one', async () => {
    const { root, settle } = await render(true);
    button(root, 'Mostra anteprima')!.click();
    await settle();
    expect(root.querySelector('ul')).not.toBeNull();
    (root.querySelectorAll('.chip')[0] as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('ul')).toBeNull();
    expect(button(root, 'Condividi PDF')).toBeUndefined();
  });
});
