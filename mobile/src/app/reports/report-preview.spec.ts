import { MigraineReportData } from '../api/api.model';
import { previewLines } from './report-preview';

const base: MigraineReportData = { from: '2026-08-07', to: '2026-11-04', days: 90, summary: null, episodes: [], recurrences: [] };

const withSummary = (episodes: number, recurrences = 0): MigraineReportData => ({
  ...base,
  summary: { episodes, headacheDays: episodes, peakMax: 8, peakAverage: 6.5, medicationDays: 1, medicationIntakes: 3, averageDurationMin: 125 },
  episodes: Array.from({ length: episodes }, (_, i) => ({
    start: i, end: null, peak: 6, symptoms: [], location: null, medicationCount: 0, medicationHelp: null, causes: [],
  })),
  recurrences: Array.from({ length: recurrences }, () => ({
    label: 'Sonno corto', headacheTriggered: 4, headacheEvaluated: 5, otherTriggered: 3, otherEvaluated: 20,
  })),
});

describe('previewLines', () => {
  it('says so when there are no headaches', () => {
    expect(previewLines(base)).toEqual(['Nessuna cefalea registrata negli ultimi 90 giorni.']);
  });

  it('gives the numbers of the PDF in short', () => {
    const lines = previewLines(withSummary(2));
    expect(lines).toContain('2 cefalee in 2 giorni.');
    expect(lines).toContain('Intensità massima 8 su 10, picco medio 6,5 su 10.');
    expect(lines).toContain('Durata media degli episodi chiusi: 2 h 05 min.');
    expect(lines).toContain('3 assunzioni di farmaco in 1 giorno.');
    expect(lines).toContain('2 episodi elencati, uno per riga.');
  });

  it('uses the singular for one headache', () => {
    const lines = previewLines(withSummary(1));
    expect(lines[0]).toBe('1 cefalea in 1 giorno.');
    expect(lines).toContain('1 episodio elencato, uno per riga.');
  });

  it('does not look for recurrences below five headaches', () => {
    expect(previewLines(withSummary(4)).at(-1)).toBe('Ricorrenze non cercate: servono almeno 5 cefalee.');
  });

  it('says whether recurrences were found, and that they are coincidences', () => {
    expect(previewLines(withSummary(6, 0)).at(-1)).toBe('Nessuna ricorrenza evidente.');
    expect(previewLines(withSummary(6, 2)).at(-1)).toContain('2 ricorrenze trovate');
    expect(previewLines(withSummary(6, 2)).at(-1)).toContain('coincidenze');
  });

  it('says when no episode is closed', () => {
    const data = withSummary(2);
    data.summary!.averageDurationMin = null;
    expect(previewLines(data)).toContain('Durata media non calcolabile: nessun episodio chiuso.');
  });
});
