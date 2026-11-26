import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { HeadacheService } from './diary/headache.service';
import { SettingsRepository } from './settings/settings.repository';
import { SettingsService } from './settings/settings.service';
import { InMemorySettingsRepository } from './settings/testing';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './diary/testing';

describe('App', () => {
  const clock = new FakeClock(new Date(2026, 10, 3, 7, 44));

  async function create() {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        ...provideDiaryTesting(new InMemoryHeadacheRepository(), clock),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository() },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => document.body.classList.remove('penombra', 'theme-dark', 'theme-light'));

  it('creates the root component', async () => {
    const fixture = await create();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('switches to the Penombra palette only while a headache is open', async () => {
    const fixture = await create();
    const headaches = TestBed.inject(HeadacheService);
    expect(document.body.classList.contains('penombra')).toBe(false);

    await headaches.start(5, clock.now());
    fixture.detectChanges();
    expect(document.body.classList.contains('penombra')).toBe(true);

    await headaches.finish();
    fixture.detectChanges();
    expect(document.body.classList.contains('penombra')).toBe(false);
  });

  it('stays out of Penombra during an episode when it is turned off in settings', async () => {
    const fixture = await create();
    await TestBed.inject(SettingsService).update({ penombra: false });
    await TestBed.inject(HeadacheService).start(5, clock.now());
    fixture.detectChanges();
    expect(document.body.classList.contains('penombra')).toBe(false);
  });

  it('applies the theme chosen in settings, and none for «Sistema»', async () => {
    const fixture = await create();
    const settings = TestBed.inject(SettingsService);
    const has = (name: string) => document.body.classList.contains(name);
    expect(has('theme-dark') || has('theme-light')).toBe(false);

    await settings.update({ theme: 'light' });
    fixture.detectChanges();
    expect(has('theme-light')).toBe(true);
    expect(has('theme-dark')).toBe(false);

    await settings.update({ theme: 'dark' });
    fixture.detectChanges();
    expect(has('theme-dark')).toBe(true);
    expect(has('theme-light')).toBe(false);

    await settings.update({ theme: 'system' });
    fixture.detectChanges();
    expect(has('theme-dark') || has('theme-light')).toBe(false);
  });
});
