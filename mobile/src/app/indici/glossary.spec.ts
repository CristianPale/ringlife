import { GLOSSARY } from './glossary';
import { RECOVERY_WEIGHTS } from './recupero.model';

describe('glossary', () => {
  it('explains every Recupero signal', () => {
    for (const id of Object.keys(RECOVERY_WEIGHTS)) {
      expect((GLOSSARY as Record<string, { help: string }>)[id]?.help.length).toBeGreaterThan(20);
    }
  });

  it('spells out the acronym when the label is one', () => {
    expect(GLOSSARY.hrv.fullName).toBe('Variabilità della frequenza cardiaca');
  });

  it('explains the units it uses', () => {
    expect(GLOSSARY.hrv.help).toContain('(ms)');
    expect(GLOSSARY['hr-riposo'].help).toContain('(bpm)');
  });
});
