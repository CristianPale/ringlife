import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CredentialsRepository } from '../api/credentials.repository';
import { InMemoryCredentialsRepository } from '../api/testing';
import { CredentialsService } from '../api/credentials.service';
import { PluginView } from '../plugins/plugin.model';
import { PluginsService } from '../plugins/plugins.service';
import { SettingsService } from './settings.service';
import { JournalService } from '../diary/journal.service';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from '../diary/testing';
import { DEFAULT_SETTINGS } from './settings.model';
import { SettingsPage } from './settings.page';
import { SettingsRepository } from './settings.repository';
import { InMemorySettingsRepository } from './testing';
import { RingDeviceService } from '../ring/ring-device.service';
import { BackgroundBridge, FakeBackgroundBridge } from '../ring/background/ring-background';

describe('SettingsPage', () => {
  /** Il ponte nativo finto: nei test il registro dei tentativi in background si sceglie qui. */
  let background = new FakeBackgroundBridge();
  beforeEach(() => (background = new FakeBackgroundBridge()));

  async function render(serverUrl = '', section?: string) {
    const repository = new InMemorySettingsRepository(serverUrl ? { ...DEFAULT_SETTINGS, serverUrl } : undefined);
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        ...provideDiaryTesting(new InMemoryHeadacheRepository(), new FakeClock(new Date(2026, 10, 3, 8, 0)), new InMemoryJournalRepository()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: repository },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
        { provide: BackgroundBridge, useValue: background },
      ],
    }).compileComponents();
    await TestBed.inject(SettingsService).init();
    await TestBed.inject(CredentialsService).init();
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
    return Object.assign(fixture.nativeElement as HTMLElement, { fixture, repository });
  }

  async function settle(root: { fixture: { detectChanges(): void; whenStable(): Promise<unknown> } }) {
    await root.fixture.whenStable();
    root.fixture.detectChanges();
  }

  it('opens on a list of the eight sections, each with a summary, and the medical footer', async () => {
    const root = await render();
    const links = Array.from(root.querySelectorAll('nav a.menu-link'));
    expect(links.map((a) => a.querySelector('.menu-title')?.textContent?.trim())).toEqual([
      'Anello',
      'Obiettivi',
      'Abitudini',
      'Profilo',
      'Plugin',
      'Notifiche',
      'Server di casa',
      'Aspetto',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/impostazioni/anello',
      '/impostazioni/obiettivi',
      '/impostazioni/abitudini',
      '/impostazioni/profilo',
      '/impostazioni/plugin',
      '/impostazioni/notifiche',
      '/impostazioni/server',
      '/impostazioni/aspetto',
    ]);
    expect(links.every((a) => (a.querySelector('.menu-summary')?.textContent?.trim() ?? '') !== '')).toBe(true);
    expect(root.querySelector('.footer')?.textContent).toContain('non è un dispositivo medico');
    // Dell'elenco non fa parte nessun campo: sta dentro le sezioni.
    expect(root.querySelector('input, select')).toBeNull();
  });

  it('summarises the state of each section in the list', async () => {
    const root = await render();
    const summary = (title: string) =>
      Array.from(root.querySelectorAll('a.menu-link'))
        .find((a) => a.querySelector('.menu-title')?.textContent?.trim() === title)
        ?.querySelector('.menu-summary')?.textContent;
    expect(summary('Anello')).toContain('Batteria 62%');
    expect(summary('Obiettivi')).toContain('8 h 00 di sonno');
    expect(summary('Profilo')).toBe('Da compilare per stimare le calorie');
    expect(summary('Server di casa')).toBe('Non configurato');
    expect(summary('Aspetto')).toBe('Tema: Sistema');
    expect(summary('Plugin')).toMatch(/^\d accesi su 7$/);
  });

  it('shows one section at a time, with its name in the title and a way back to the list', async () => {
    const root = await render('', 'obiettivi');
    expect(root.querySelector('ion-title')?.textContent?.trim()).toBe('Obiettivi');
    expect(root.querySelectorAll('section')).toHaveLength(1);
    expect(root.querySelector('section#obiettivi, section[aria-labelledby="obiettivi"]')).not.toBeNull();
    expect(root.querySelector('a.menu-link')).toBeNull();
    expect(root.querySelector('.footer')).toBeNull();
  });

  it('adds a habitual caffeine that the diary records by itself, and removes it', async () => {
    const root = await render('', 'abitudini');
    expect(root.querySelector('section[aria-labelledby="abitudini"] .hint')?.textContent).toContain('Il Diario lo segna da solo');
    const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="abitudini"] app-chip-group .chip'));
    chips.find((c) => c.textContent?.trim() === 'Tè')!.click();
    const time = root.querySelector<HTMLInputElement>('section[aria-labelledby="abitudini"] input[type="time"]')!;
    time.value = '07:15';
    time.dispatchEvent(new Event('change'));
    Array.from(root.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="abitudini"] button.button'))
      .find((b) => b.textContent?.trim() === 'Aggiungi')!
      .click();
    await settle(root);
    await settle(root);
    expect(TestBed.inject(SettingsService).settings().habitualCaffeine.map((h) => [h.drink, h.time])).toEqual([['tea', '07:15']]);
    expect(root.querySelector('.field.habit .field-label')?.textContent).toBe('1 tè alle 07:15');
    // L'ora è passata (sono le 8): la voce di oggi è già nel diario.
    expect(TestBed.inject(JournalService).entries().map((e) => e.kind)).toEqual(['caffeine']);

    root.querySelector<HTMLButtonElement>('.field.habit button')!.click();
    await settle(root);
    expect(TestBed.inject(SettingsService).settings().habitualCaffeine).toEqual([]);
  });

  it('links to the guide below the sections', async () => {
    const root = await render();
    const guide = root.querySelector<HTMLAnchorElement>('a.menu-link[href="/guida"]');
    expect(guide?.querySelector('.menu-title')?.textContent).toBe('Guida');
  });

  it('falls back to the list for a section that does not exist', async () => {
    const root = await render('', 'boh');
    expect(root.querySelectorAll('nav a.menu-link')).toHaveLength(8);
  });

  it('starts with the ring card, which in the browser says the ring is not read here', async () => {
    const root = await render();
    const card = root.querySelector('app-ring-card');
    expect(card).not.toBeNull();
    // In cima: prima dell'elenco delle sezioni.
    expect(card?.compareDocumentPosition(root.querySelector('nav')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(card?.textContent).toContain("Nel browser l'anello non si legge");
    expect(card?.querySelector('button')).toBeNull();
  });

  it('shows the firmware as not read yet, says RingLife does not update it, and never sends the user to the vendor app', async () => {
    const root = await render('', 'anello');
    expect(root.textContent).toContain('non ancora letto');
    expect(root.textContent).toContain('RingLife non aggiorna il firmware');
    expect(root.textContent).not.toContain('app del produttore');
  });

  it('saves the hand and finger the ring is worn on, and says when they changed', async () => {
    const root = await render('', 'anello');
    const chip = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('app-chip-group button')).find((b) => b.textContent?.trim() === label)!;
    chip('Destra').click();
    await settle(root);
    chip('Anulare').click();
    await settle(root);
    expect(root.repository.saved.at(-1)?.wear).toMatchObject({ hand: 'right', finger: 'ring' });
    expect(root.textContent).toContain('Cambiato il');
  });

  it('lists the last background attempts, saying where a failed one stopped', async () => {
    // Pochi minuti fa: il giorno resta «oggi» in ogni fuso; l'ora esatta dipende dal fuso e non si controlla.
    const now = Date.now();
    background.log = [
      { at: now - 120_000, end: now - 95_000, source: 'shortcut', outcome: 'time_limit', stage: 'connecting', done: 0, total: 13, chain: '' },
      { at: now - 600_000, end: now - 586_000, source: 'background', outcome: 'saved', stage: '', done: 13, total: 13, chain: '' },
    ];
    const root = await render('', 'anello');
    await settle(root);
    const lines = Array.from(root.querySelectorAll('.attempts li')).map((li) => li.textContent?.trim() ?? '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^(oggi|ieri) alle \d\d:\d\d · Comandi · non riuscita: tempo scaduto, fermata durante il collegamento, 0 richieste su 13$/,
    );
    expect(lines[1]).toMatch(/^(oggi|ieri) alle \d\d:\d\d · iOS · riuscita in 14 s$/);
  });

  it('links the Shortcuts guide and opens Shortcuts (docs/adr/0048)', async () => {
    const root = await render('', 'anello');
    await settle(root);
    expect(root.querySelector('a[href*="guida/automazioni"]')?.textContent).toContain('automazioni di Comandi');
    Array.from(root.querySelectorAll<HTMLButtonElement>('button.button'))
      .find((b) => b.textContent?.trim() === 'Apri Comandi')!
      .click();
    expect(background.shortcutsOpened).toBe(1);
  });

  it('says the ring is unlinked instead of showing its battery', async () => {
    const root = await render();
    await TestBed.inject(RingDeviceService).unlink();
    await settle(root);
    const summary = Array.from(root.querySelectorAll('a.menu-link'))
      .find((a) => a.querySelector('.menu-title')?.textContent?.trim() === 'Anello')
      ?.querySelector('.menu-summary')?.textContent;
    expect(summary).toBe('Scollegato da RingLife');
  });

  it('explains SpO2 instead of leaving the acronym alone', async () => {
    const root = await render('', 'anello');
    expect(root.textContent).toContain("ossigeno nel sangue (SpO2)");
    expect(root.textContent).toContain('saturazione di ossigeno');
  });

  it('is honest that the ring is not connected: the sync button is disabled', async () => {
    const root = await render('', 'anello');
    expect(root.querySelector<HTMLButtonElement>('.button')?.disabled).toBe(true);
    expect(root.textContent).toContain("l'anello non è ancora collegato");
  });

  it('shows the defaults in the goals', async () => {
    const root = await render('', 'obiettivi');
    const selects = root.querySelectorAll<HTMLSelectElement>('select');
    expect(selects[0].selectedOptions[0].textContent?.trim()).toBe('8 h 00');
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    expect(inputs[0].value).toBe('23:30');
    expect(inputs[1].value).toBe('07:00');
    expect(inputs[2].value).toBe('8000');
  });

  it('saves a new sleep goal', async () => {
    const root = await render('', 'obiettivi');
    const select = root.querySelectorAll<HTMLSelectElement>('select')[0];
    select.value = '450';
    select.dispatchEvent(new Event('change'));
    await settle(root);
    expect(root.repository.saved.at(-1)?.sleepGoalMin).toBe(450);
  });

  it('puts a steps goal outside the limits back inside, and shows it', async () => {
    const root = await render('', 'obiettivi');
    const input = root.querySelectorAll<HTMLInputElement>('input')[2];
    input.value = '99';
    input.dispatchEvent(new Event('change'));
    await settle(root);
    expect(root.repository.saved.at(-1)?.stepsGoal).toBe(1000);
    expect(input.value).toBe('1000');
  });

  it('ignores an emptied time field and restores the last valid one', async () => {
    const root = await render('', 'obiettivi');
    const input = root.querySelectorAll<HTMLInputElement>('input')[0];
    input.value = '';
    input.dispatchEvent(new Event('change'));
    await settle(root);
    expect(input.value).toBe('23:30');
    expect(root.repository.saved).toHaveLength(0);
  });

  it('toggles a plugin and reports the state in words', async () => {
    const root = await render('', 'plugin');
    const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="plugin"] [role="switch"]'));
    expect(rows).toHaveLength(7);
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect(rows[0].textContent).toContain('Acceso');
    rows[0].click();
    await settle(root);
    expect(rows[0].getAttribute('aria-checked')).toBe('false');
    expect(rows[0].textContent).toContain('Spento');
    expect(root.repository.saved.at(-1)?.plugins.migraine).toBe(false);
  });

  it('switches the theme', async () => {
    const root = await render('', 'aspetto');
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="aspetto"] app-chip-group .chip'),
    );
    expect(buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent).toContain('Sistema');
    buttons.find((b) => b.textContent?.includes('Scuro'))?.click();
    await settle(root);
    expect(root.repository.saved.at(-1)?.theme).toBe('dark');
  });

  it('keeps the theme when the active one is tapped again', async () => {
    const root = await render('', 'aspetto');
    root.querySelector<HTMLButtonElement>('section[aria-labelledby="aspetto"] app-chip-group .chip[aria-pressed="true"]')?.click();
    await settle(root);
    expect(root.repository.saved).toHaveLength(0);
  });

  it('turns Penombra off', async () => {
    const root = await render('', 'aspetto');
    const row = root.querySelector<HTMLButtonElement>('section[aria-labelledby="aspetto"] [role="switch"]');
    row?.click();
    await settle(root);
    expect(root.repository.saved.at(-1)?.penombra).toBe(false);
  });

  it('saves a valid server address and warns about an invalid one without losing the saved one', async () => {
    const root = await render('', 'server');
    const input = root.querySelector<HTMLInputElement>('input[type="url"]')!;
    input.value = 'https://ringlife.example.net/';
    input.dispatchEvent(new Event('change'));
    await settle(root);
    expect(root.repository.saved.at(-1)?.serverUrl).toBe('https://ringlife.example.net');
    expect(root.querySelector('.error')).toBeNull();

    input.value = 'ftp://x';
    input.dispatchEvent(new Event('change'));
    await settle(root);
    expect(root.querySelector('.error')?.textContent).toContain('https://');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(root.repository.saved).toHaveLength(1);
  });

  describe('profile', () => {
    function field(root: HTMLElement, label: string): HTMLInputElement {
      const found = Array.from(root.querySelectorAll('section[aria-labelledby="profilo"] label.field')).find((l) =>
        l.textContent?.includes(label),
      );
      return found!.querySelector('input')!;
    }

    it('says where the data stays and what the sex is for', async () => {
      const root = await render('', 'profilo');
      const text = root.querySelector('section[aria-labelledby="profilo"]')?.textContent ?? '';
      expect(text).toContain('Restano sul tuo telefono');
      expect(text).toContain('Serve alla formula del metabolismo');
    });

    it('saves a valid weight, height and birth year', async () => {
      const root = await render('', 'profilo');
      for (const [label, value] of [
        ['Anno di nascita', '1985'],
        ['Altezza', '178'],
        ['Peso', '75.5'],
      ]) {
        const input = field(root, label);
        input.value = value;
        input.dispatchEvent(new Event('change'));
        await settle(root);
      }
      expect(root.repository.saved.at(-1)?.profile).toEqual({
        sex: 'unspecified',
        birthYear: 1985,
        heightCm: 178,
        weightKg: 75.5,
      });
    });

    it('does not save an out-of-range value and shows the previous one again', async () => {
      const root = await render('', 'profilo');
      const height = field(root, 'Altezza');
      height.value = '178';
      height.dispatchEvent(new Event('change'));
      await settle(root);
      height.value = '17';
      height.dispatchEvent(new Event('change'));
      await settle(root);
      expect(height.value).toBe('178');
      expect(root.repository.saved.at(-1)?.profile.heightCm).toBe(178);
    });

    it('clears a field that is emptied', async () => {
      const root = await render('', 'profilo');
      const weight = field(root, 'Peso');
      weight.value = '70';
      weight.dispatchEvent(new Event('change'));
      await settle(root);
      weight.value = '';
      weight.dispatchEvent(new Event('change'));
      await settle(root);
      expect(root.repository.saved.at(-1)?.profile.weightKg).toBeNull();
    });

    it('saves the sex', async () => {
      const root = await render('', 'profilo');
      const buttons = Array.from(
        root.querySelectorAll<HTMLButtonElement>('section[aria-labelledby="profilo"] app-chip-group .chip'),
      );
      buttons.find((b) => b.textContent?.includes('Donna'))?.click();
      await settle(root);
      expect(root.repository.saved.at(-1)?.profile.sex).toBe('female');
    });
  });
  describe('plugin parameters', () => {
    const migraine: PluginView = {
      manifest: {
        id: 'migraine',
        name: 'Emicrania',
        description: '',
        version: '1',
        requires: [],
        config: [{ key: 'sleepHours', label: 'Sonno corto', type: 'INT', defaultValue: 6, min: 3, max: 9 }],
      },
      enabled: true,
      config: { sleepHours: 6 },
      result: null,
    };

    it('shows the parameters of a plugin that has some, under its switch', async () => {
      const root = await render('', 'plugin');
      TestBed.inject(PluginsService).views.set([migraine]);
      root.fixture.detectChanges();
      expect(root.querySelectorAll('app-plugin-config')).toHaveLength(1);
      expect(root.querySelector('app-plugin-config')?.textContent).toContain('Sonno corto');
    });

    it('shows nothing while the phone has no server plugins', async () => {
      const root = await render('', 'plugin');
      expect(root.querySelector('app-plugin-config')).toBeNull();
    });

    it('hides the parameters when the plugin is off on this phone', async () => {
      const root = await render('', 'plugin');
      TestBed.inject(PluginsService).views.set([migraine]);
      await TestBed.inject(SettingsService).setPlugin('migraine', false);
      root.fixture.detectChanges();
      expect(root.querySelector('app-plugin-config')).toBeNull();
    });
  });

  describe('server connection', () => {
    const URL = 'https://ringlife.example.net';

    async function renderWithServer() {
      const root = await render(URL, 'server');
      await settle(root);
      return { root, http: TestBed.inject(HttpTestingController) };
    }

    /** Un telefono senza diario che si collega chiede al server il diario: qui il server non ne ha. */
    async function answerEmptyDiary(http: HttpTestingController, device: string) {
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne(`${URL}/api/v1/devices/${device}/diary`).flush({ entries: [], episodes: [] });
      await new Promise<void>((resolve) => setTimeout(resolve));
    }

    const homeField = (root: HTMLElement): HTMLInputElement =>
      Array.from(root.querySelectorAll('section[aria-labelledby="server"] label.field'))
        .find((l) => l.textContent?.includes('rete di casa'))!
        .querySelector('input')!;

    const button = (root: HTMLElement, label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label);

    it('checks the server on demand and says it answers', async () => {
      const { root, http } = await renderWithServer();
      button(root, 'Verifica')!.click();
      http.expectOne(`${URL}/actuator/health`).flush({ status: 'UP' });
      await settle(root);
      expect(root.querySelector('.server-status')?.textContent).toContain('Raggiungibile');
      http.verify();
    });

    it('says when the server answered on the home network, without encryption', async () => {
      const { root, http } = await renderWithServer();
      const home = homeField(root);
      home.value = '192.168.1.20:8080';
      home.dispatchEvent(new Event('change'));
      await settle(root);
      expect(root.repository.saved.at(-1)?.homeUrl).toBe('http://192.168.1.20:8080');
      button(root, 'Verifica')!.click();
      http.expectOne(`${URL}/actuator/health`).error(new ProgressEvent('error'));
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne('http://192.168.1.20:8080/actuator/health').flush({ status: 'UP' });
      await settle(root);
      expect(root.querySelector('.server-status')?.textContent).toContain('rete di casa, senza cifratura');
      http.verify();
    });

    it('does not save a home address outside the home network and warns', async () => {
      const { root } = await renderWithServer();
      const home = homeField(root);
      home.value = 'http://8.8.8.8:8080';
      home.dispatchEvent(new Event('change'));
      await settle(root);
      expect(root.querySelector('#home-error')).not.toBeNull();
      expect(root.repository.saved.at(-1)?.homeUrl ?? '').toBe('');
    });

    it('clears the home address when the field is emptied', async () => {
      const { root } = await renderWithServer();
      const home = homeField(root);
      home.value = '192.168.1.20:8080';
      home.dispatchEvent(new Event('change'));
      await settle(root);
      home.value = '';
      home.dispatchEvent(new Event('change'));
      await settle(root);
      expect(root.repository.saved.at(-1)?.homeUrl).toBe('');
    });

    it('says the server does not answer', async () => {
      const { root, http } = await renderWithServer();
      button(root, 'Verifica')!.click();
      http.expectOne(`${URL}/actuator/health`).error(new ProgressEvent('error'));
      await settle(root);
      expect(root.querySelector('.server-status')?.textContent).toContain('non risponde');
      http.verify();
    });

    it('pairs with the secret, shows the paired state and clears the field', async () => {
      const { root, http } = await renderWithServer();
      const field = root.querySelector<HTMLInputElement>('input[type=password]')!;
      field.value = 'synthetic-secret';
      button(root, 'Collega questo telefono')!.click();
      const request = http.expectOne(`${URL}/api/v1/devices`);
      expect(request.request.headers.get('X-Pairing-Secret')).toBe('synthetic-secret');
      request.flush({ deviceId: 'dev-1', token: 'tok-1' });
      await answerEmptyDiary(http, 'dev-1');
      await settle(root);
      expect(root.querySelector('.paired')?.textContent).toContain('collegato');
      expect(root.querySelector('input[type=password]')).toBeNull();
      expect(field.value).toBe('');
      http.verify();
    });

    it('explains a wrong secret in plain words', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 'wrong';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush('', { status: 401, statusText: 'Unauthorized' });
      await settle(root);
      expect(root.querySelector('#pair-error')?.textContent).toContain('segreto');
      http.verify();
    });

    it('asks for the secret instead of sending an empty one', async () => {
      const { root, http } = await renderWithServer();
      button(root, 'Collega questo telefono')!.click();
      await settle(root);
      expect(root.querySelector('#pair-error')?.textContent).toContain('Inserisci il segreto');
      http.expectNone(`${URL}/api/v1/devices`);
      http.verify();
    });

    it('unpairs and goes back to asking for the secret', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 's';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush({ deviceId: 'd', token: 't' });
      await answerEmptyDiary(http, 'd');
      await settle(root);
      button(root, 'Scollega')!.click();
      await settle(root);
      expect(root.querySelector('.paired')).toBeNull();
      expect(root.querySelector('input[type=password]')).not.toBeNull();
      http.verify();
    });

    it('brings back the diary of the server right after pairing a phone that has none', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 's';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush({ deviceId: 'd', token: 't' });
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne(`${URL}/api/v1/devices/d/diary`).flush({
        entries: [{ id: 'srv-entry-1', ts: Date.now(), kind: 'caffeine', drink: 'tea' }],
        episodes: [],
      });
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.textContent).toContain('Riportati 1 elemento del diario.');
      http.verify();
    });

    it('shows the identifier of this phone and takes the one of a previous phone', async () => {
      const { root } = await renderWithServer();
      const own = root.querySelector('code')!.textContent!;
      expect(own).toMatch(/^phone-/);
      const field = root.querySelector<HTMLInputElement>('input[placeholder="phone-…"]')!;
      field.value = 'phone-1111-2222-3333';
      button(root, 'Usa questo identificativo')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.querySelector('code')!.textContent).toBe('phone-1111-2222-3333');
      expect(field.value).toBe('');
    });

    it('refuses a badly formed identifier and says so', async () => {
      const { root } = await renderWithServer();
      const own = root.querySelector('code')!.textContent;
      root.querySelector<HTMLInputElement>('input[placeholder="phone-…"]')!.value = 'no';
      button(root, 'Usa questo identificativo')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.querySelector('#id-error')?.textContent).toContain('Identificativo non valido');
      expect(root.querySelector('code')!.textContent).toBe(own);
    });

    it('lets a paired phone restore the diary on demand, and tells when there is nothing to add', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 's';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush({ deviceId: 'd', token: 't' });
      await answerEmptyDiary(http, 'd');
      await settle(root);

      button(root, 'Ripristina il diario dal server')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne(`${URL}/api/v1/devices/d/diary`).flush({ entries: [], episodes: [] });
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.textContent).toContain('Il telefono ha già tutto il diario del server.');
      http.verify();
    });

    it('hides the pairing until a server address is set', async () => {
      const root = await render('', 'server');
      expect(root.querySelector('input[type=password]')).toBeNull();
      expect(button(root, 'Verifica')!.disabled).toBe(true);
    });
    it('uploads the demo data, then reads the days back, and says how many were new', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 's';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush({ deviceId: 'd', token: 't' });
      await answerEmptyDiary(http, 'd');
      await settle(root);

      button(root, 'Carica dati di prova')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      const sleep = http.expectOne(`${URL}/api/v1/devices/d/sleep`);
      expect(sleep.request.body.sessions.length).toBeGreaterThanOrEqual(7);
      sleep.flush({ received: 10, inserted: 10, duplicates: 0 });
      await new Promise<void>((resolve) => setTimeout(resolve));
      const samples = http.expectOne(`${URL}/api/v1/devices/d/samples`);
      expect(samples.request.body.samples.length).toBeGreaterThan(100);
      samples.flush({ received: 1000, inserted: 900, duplicates: 100 });
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne((r) => r.url === `${URL}/api/v1/devices/d/days`).flush([]);
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.textContent).toContain('Caricati 900 campioni e 10 notti nuovi (già presenti: 100).');
      http.verify();
    });

    it('says why the upload failed instead of staying silent', async () => {
      const { root, http } = await renderWithServer();
      root.querySelector<HTMLInputElement>('input[type=password]')!.value = 's';
      button(root, 'Collega questo telefono')!.click();
      http.expectOne(`${URL}/api/v1/devices`).flush({ deviceId: 'd', token: 't' });
      await answerEmptyDiary(http, 'd');
      await settle(root);
      button(root, 'Carica dati di prova')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      http.expectOne(`${URL}/api/v1/devices/d/sleep`).error(new ProgressEvent('error'));
      await new Promise<void>((resolve) => setTimeout(resolve));
      await settle(root);
      expect(root.textContent).toContain('Il server non risponde');
      http.verify();
    });
  });
});
