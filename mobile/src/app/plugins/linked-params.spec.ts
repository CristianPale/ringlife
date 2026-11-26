import { DEFAULT_SETTINGS, Settings } from '../settings/settings.model';
import { alignedConfig, followsSettings } from './linked-params';
import { PluginView } from './plugin.model';

const settings: Settings = { ...DEFAULT_SETTINGS, bedtime: '23:45', wakeTime: '06:30', sleepGoalMin: 450 };

function caffeine(config: Record<string, unknown> = {}): PluginView {
  return {
    manifest: {
      id: 'caffeine-window',
      name: 'Caffeina',
      description: '',
      version: '1',
      requires: [],
      config: [
        { key: 'wakeTime', label: 'Risveglio abituale', type: 'TIME', defaultValue: '07:00', min: null, max: null },
        { key: 'sleepGoalHours', label: 'Obiettivo di sonno: ore', type: 'INT', defaultValue: 8, min: 5, max: 10 },
        { key: 'delayMin', label: 'Attesa', type: 'INT', defaultValue: 90, min: 0, max: 240 },
      ],
    },
    enabled: true,
    config,
    result: null,
  };
}

describe('linked plugin parameters', () => {
  it('follow Obiettivi unless chosen by hand for that plugin', () => {
    expect(followsSettings('caffeine-window', 'wakeTime', settings)).toBe(true);
    expect(followsSettings('caffeine-window', 'delayMin', settings)).toBe(false);
    const overridden = { ...settings, pluginOverrides: { 'caffeine-window': ['wakeTime'] } };
    expect(followsSettings('caffeine-window', 'wakeTime', overridden)).toBe(false);
    expect(followsSettings('circadian', 'wakeTime', overridden)).toBe(true);
  });

  it('builds the config that aligns the plugin with Obiettivi, keeping hand-picked values', () => {
    // 7 h 30 di obiettivo diventa 8 ore (il parametro è in ore intere).
    expect(alignedConfig(caffeine({ delayMin: 120 }), settings)).toEqual({ wakeTime: '06:30', delayMin: 120 });
  });

  it('says nothing to do when the plugin is already aligned', () => {
    expect(alignedConfig(caffeine({ wakeTime: '06:30' }), settings)).toBeNull();
  });

  it('leaves a parameter chosen by hand alone', () => {
    const overridden = { ...settings, pluginOverrides: { 'caffeine-window': ['wakeTime', 'sleepGoalHours'] } };
    expect(alignedConfig(caffeine({ wakeTime: '09:00' }), overridden)).toBeNull();
  });
});
