import { caffeineWindowOf } from './caffeine-window';
import { PluginView } from './plugin.model';

function view(config: Record<string, unknown>, defaults = true): PluginView {
  return {
    manifest: {
      id: 'caffeine-window',
      name: 'Finestra caffeina',
      description: '',
      version: '1',
      requires: [],
      config: defaults
        ? [
            { key: 'wakeTime', label: '', type: 'TIME', defaultValue: '07:00', min: null, max: null },
            { key: 'sleepGoalHours', label: '', type: 'INT', defaultValue: 8, min: 5, max: 10 },
            { key: 'delayMinutes', label: '', type: 'INT', defaultValue: 90, min: 0, max: 180 },
            { key: 'cutoffHours', label: '', type: 'INT', defaultValue: 8, min: 4, max: 12 },
          ]
        : [],
    },
    enabled: true,
    config,
    result: null,
  };
}

describe('caffeineWindowOf', () => {
  it('con i parametri predefiniti va dalle 08:30 alle 15:00 (ADR 0016)', () => {
    expect(caffeineWindowOf(view({}))).toEqual({ startMin: 510, endMin: 900 });
  });

  it('usa i parametri scelti: con due ore di attesa parte alle 09:00', () => {
    expect(caffeineWindowOf(view({ delayMinutes: 120 }))).toEqual({ startMin: 540, endMin: 900 });
  });

  it('legge il risveglio abituale', () => {
    expect(caffeineWindowOf(view({ wakeTime: '06:00' }))).toEqual({ startMin: 450, endMin: 840 });
  });

  it('senza finestra quando lo stop cade prima dell’inizio', () => {
    expect(caffeineWindowOf(view({ sleepGoalHours: 10, cutoffHours: 12, delayMinutes: 180 }))).toBeNull();
  });

  it('ripiega sui valori predefiniti se il server non manda né parametri né manifest', () => {
    expect(caffeineWindowOf(view({}, false))).toEqual({ startMin: 510, endMin: 900 });
    expect(caffeineWindowOf(view({ wakeTime: 'boh' }, false))).toEqual({ startMin: 510, endMin: 900 });
  });
});
