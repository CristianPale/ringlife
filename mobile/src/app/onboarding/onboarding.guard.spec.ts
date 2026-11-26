import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { onboardingGuard } from './onboarding.guard';

describe('onboardingGuard', () => {
  async function run(onboarded: boolean, native: boolean) {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, onboarded }) }],
    });
    await TestBed.inject(SettingsService).init();
    return TestBed.runInInjectionContext(() => onboardingGuard({} as never, {} as never));
  }

  afterEach(() => vi.restoreAllMocks());

  it('sends a phone that has not finished the wizard to the wizard', async () => {
    const result = await run(false, true);
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/benvenuto');
  });

  it('lets a phone through once the wizard is finished', async () => {
    expect(await run(true, true)).toBe(true);
  });

  it('never blocks the browser dashboard', async () => {
    expect(await run(false, false)).toBe(true);
  });
});
