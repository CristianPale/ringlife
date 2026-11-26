import { DEFAULT_SETTINGS, isValidTime, normalizeHomeUrl, normalizeServerUrl, normalizeSettings } from './settings.model';

describe('settings model', () => {
  it('falls back to the defaults for anything unreadable', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones one by one', () => {
    const result = normalizeSettings({ sleepGoalMin: 450, bedtime: '25:00', wakeTime: '06:45', theme: 'neon', penombra: 'yes' });
    expect(result.sleepGoalMin).toBe(450);
    expect(result.bedtime).toBe(DEFAULT_SETTINGS.bedtime);
    expect(result.wakeTime).toBe('06:45');
    expect(result.theme).toBe('system');
    expect(result.penombra).toBe(true);
  });

  it('limits goals to a sensible range', () => {
    expect(normalizeSettings({ sleepGoalMin: 60 }).sleepGoalMin).toBe(300);
    expect(normalizeSettings({ sleepGoalMin: 9999 }).sleepGoalMin).toBe(600);
    expect(normalizeSettings({ stepsGoal: 10 }).stepsGoal).toBe(1000);
    expect(normalizeSettings({ stepsGoal: 999999 }).stepsGoal).toBe(50000);
  });

  it('rounds the sleep goal to half hours', () => {
    expect(normalizeSettings({ sleepGoalMin: 461 }).sleepGoalMin).toBe(450);
    expect(normalizeSettings({ sleepGoalMin: 475 }).sleepGoalMin).toBe(480);
  });

  it('accepts only known ring intervals', () => {
    expect(normalizeSettings({ ring: { hrIntervalMin: 15 } }).ring.hrIntervalMin).toBe(15);
    expect(normalizeSettings({ ring: { hrIntervalMin: 7 } }).ring.hrIntervalMin).toBe(5);
  });

  it('fills missing plugins with their default and ignores unknown ones', () => {
    const result = normalizeSettings({ plugins: { migraine: false, unknown: true } });
    expect(result.plugins.migraine).toBe(false);
    expect(result.plugins.circadian).toBe(true);
    expect('unknown' in result.plugins).toBe(false);
  });

  it('validates times', () => {
    expect(isValidTime('23:30')).toBe(true);
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:00')).toBe(false);
    expect(isValidTime('')).toBe(false);
    expect(isValidTime(null)).toBe(false);
  });

  it('accepts only http and https server addresses', () => {
    expect(normalizeServerUrl('https://ringlife.example.net')).toBe('https://ringlife.example.net');
    expect(normalizeServerUrl('  https://ringlife.example.net/ ')).toBe('https://ringlife.example.net');
    expect(normalizeServerUrl('http://192.0.2.10:8080')).toBe('http://192.0.2.10:8080');
    expect(normalizeServerUrl('ftp://example.net')).toBe('');
    expect(normalizeServerUrl('javascript:alert(1)')).toBe('');
    expect(normalizeServerUrl('non un indirizzo')).toBe('');
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl(42)).toBe('');
  });

  describe('profile', () => {
    it('starts empty, with the sex not stated', () => {
      expect(DEFAULT_SETTINGS.profile).toEqual({ sex: 'unspecified', birthYear: null, heightCm: null, weightKg: null });
    });

    it('keeps valid values', () => {
      const profile = normalizeSettings({ profile: { sex: 'female', birthYear: 1990, heightCm: 165, weightKg: 58.46 } }).profile;
      expect(profile).toEqual({ sex: 'female', birthYear: 1990, heightCm: 165, weightKg: 58.5 });
    });

    it('turns an out-of-range or unreadable value into an empty field, one by one', () => {
      const profile = normalizeSettings({ profile: { sex: 'x', birthYear: 1800, heightCm: '170', weightKg: 20 } }).profile;
      expect(profile).toEqual({ sex: 'unspecified', birthYear: null, heightCm: null, weightKg: null });
    });
  });
});

describe('background', () => {
  it('reads every hour with battery alerts on by default', () => {
    expect(normalizeSettings({}).background).toEqual({ intervalMin: 60, batteryAlerts: true, ringWatch: true });
  });

  it('keeps a valid choice and drops an unknown interval', () => {
    expect(normalizeSettings({ background: { intervalMin: 0, batteryAlerts: false, ringWatch: false } }).background).toEqual({
      intervalMin: 0,
      batteryAlerts: false,
      ringWatch: false,
    });
    expect(normalizeSettings({ background: { intervalMin: 7 } }).background.intervalMin).toBe(60);
  });
});

describe('wear', () => {
  it('is the left index finger by default, never changed', () => {
    expect(normalizeSettings({}).wear).toEqual({ hand: 'left', finger: 'index', changedAt: null });
  });

  it('keeps a valid choice and drops unknown values one by one', () => {
    expect(normalizeSettings({ wear: { hand: 'right', finger: 'ring', changedAt: 5 } }).wear).toEqual({ hand: 'right', finger: 'ring', changedAt: 5 });
    expect(normalizeSettings({ wear: { hand: 'up', finger: 'thumb', changedAt: 'ieri' } }).wear).toEqual({ hand: 'left', finger: 'index', changedAt: null });
  });
});

describe('onboarded', () => {
  it('is false by default', () => {
    expect(normalizeSettings({}).onboarded).toBe(false);
  });

  it('keeps what was saved', () => {
    expect(normalizeSettings({ onboarded: true }).onboarded).toBe(true);
  });

  it('counts settings saved before the wizard as done when a server is already set', () => {
    expect(normalizeSettings({ serverUrl: 'https://ringlife.example.net' }).onboarded).toBe(true);
    expect(normalizeSettings({ serverUrl: '' }).onboarded).toBe(false);
  });
});

describe('normalizeHomeUrl', () => {
  it.each([
    ['http://192.168.1.20:8080', 'http://192.168.1.20:8080'],
    ['http://10.0.0.5:8080/', 'http://10.0.0.5:8080'],
    ['http://172.16.0.9:8080', 'http://172.16.0.9:8080'],
    ['http://172.31.255.1:8080', 'http://172.31.255.1:8080'],
    ['http://169.254.10.10:8080', 'http://169.254.10.10:8080'],
    ['http://ringlife.local:8080', 'http://ringlife.local:8080'],
    ['  http://192.168.1.20:8080  ', 'http://192.168.1.20:8080'],
    ['', ''],
  ])('accepts %s', (input, expected) => {
    expect(normalizeHomeUrl(input)).toBe(expected);
  });

  it.each([
    'http://8.8.8.8:8080',
    'http://172.15.0.1:8080',
    'http://172.32.0.1:8080',
    'http://192.169.1.1:8080',
    'http://11.0.0.1:8080',
    'http://example.com:8080',
    'http://ringlife.example.net',
    'http://192.168.1.999:8080',
    'https://192.168.1.20:8080',
    'ftp://192.168.1.20',
    'http://user:pass@192.168.1.20:8080',
    'http://192.168.1.20.example.com',
    '192.168.1.20',
    'not a url',
  ])('rejects %s, so the token can never go out in the clear to the internet', (input) => {
    expect(normalizeHomeUrl(input)).toBe('');
  });

  it('rejects anything that is not text', () => {
    expect(normalizeHomeUrl(null)).toBe('');
    expect(normalizeHomeUrl(42)).toBe('');
  });

  it('is applied when settings are read back from storage', () => {
    expect(normalizeSettings({ homeUrl: 'http://8.8.8.8' }).homeUrl).toBe('');
    expect(normalizeSettings({ homeUrl: 'http://192.168.1.20:8080' }).homeUrl).toBe('http://192.168.1.20:8080');
    expect(normalizeSettings({}).homeUrl).toBe('');
  });
});
