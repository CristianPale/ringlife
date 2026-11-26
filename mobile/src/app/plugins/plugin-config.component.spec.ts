import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CredentialsRepository } from '../api/credentials.repository';
import { CredentialsService } from '../api/credentials.service';
import { InMemoryCredentialsRepository } from '../api/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { PluginConfigComponent } from './plugin-config.component';
import { PluginView } from './plugin.model';
import { PluginsService } from './plugins.service';

const URL = 'https://ringlife.example.net';
const PUT = `${URL}/api/v1/devices/dev-1/plugins/migraine`;

function view(config: Record<string, unknown> = {}): PluginView {
  return {
    manifest: {
      id: 'migraine',
      name: 'Emicrania',
      description: '',
      version: '1',
      requires: [],
      config: [
        { key: 'sleepHours', label: 'Sonno corto: ore dormite sotto', type: 'INT', defaultValue: 6, min: 3, max: 9 },
        { key: 'loud', label: 'Avvisa', type: 'BOOL', defaultValue: false, min: null, max: null },
        { key: 'wake', label: 'Risveglio', type: 'TIME', defaultValue: '07:00', min: null, max: null },
      ],
    },
    enabled: true,
    config: { sleepHours: 6, loud: false, wake: '07:00', ...config },
    result: null,
  };
}

describe('PluginConfigComponent', () => {
  let http: HttpTestingController;

  async function render(initial = view()) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: URL }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(SettingsService).init();
    const credentials = TestBed.inject(CredentialsService);
    await credentials.init();
    await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    const plugins = TestBed.inject(PluginsService);
    plugins.views.set([initial]);
    const fixture = TestBed.createComponent(PluginConfigComponent);
    fixture.componentRef.setInput('plugin', initial);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const change = async (input: HTMLInputElement, value: string | boolean) => {
      if (typeof value === 'boolean') {
        input.checked = value;
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('change'));
      await new Promise<void>((resolve) => setTimeout(resolve));
    };
    return { root, fixture, plugins, change };
  }

  afterEach(() => http.verify());

  const input = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll('.field'))
      .find((l) => l.textContent?.includes(label))!
      .querySelector('input')!;

  it('draws one field per parameter, with its label and its range', async () => {
    const { root } = await render();
    const sleep = input(root, 'Sonno corto');
    expect(sleep.type).toBe('number');
    expect(sleep.min).toBe('3');
    expect(sleep.max).toBe('9');
    expect(sleep.value).toBe('6');
    expect(input(root, 'Avvisa').type).toBe('checkbox');
    expect(input(root, 'Risveglio').type).toBe('time');
    expect(root.textContent).toContain('non evidenze');
  });

  it('sends only the values that differ from the defaults', async () => {
    const { root, change } = await render();
    await change(input(root, 'Sonno corto'), '7');
    const request = http.expectOne(PUT);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ config: { sleepHours: 7 } });
    request.flush(view({ sleepHours: 7 }));
  });

  it('keeps the other changed values when one more is changed, and drops one set back to its default', async () => {
    const { root, fixture, change } = await render(view({ sleepHours: 7 }));
    await change(input(root, 'Avvisa'), true);
    let request = http.expectOne(PUT);
    expect(request.request.body).toEqual({ config: { sleepHours: 7, loud: true } });
    request.flush(view({ sleepHours: 7, loud: true }));
    await new Promise<void>((resolve) => setTimeout(resolve));
    // Nella pagina il plugin si aggiorna da solo con la risposta del server.
    fixture.componentRef.setInput('plugin', view({ sleepHours: 7, loud: true }));
    fixture.detectChanges();

    await change(input(root, 'Sonno corto'), '6');
    request = http.expectOne(PUT);
    expect(request.request.body).toEqual({ config: { loud: true } });
    request.flush(view({ loud: true }));
  });

  it('refuses a value out of range without calling the server, and puts the old one back', async () => {
    const { root, fixture, change } = await render();
    const sleep = input(root, 'Sonno corto');
    await change(sleep, '12');
    http.expectNone(PUT);
    fixture.detectChanges();
    expect(root.querySelector('.error')?.textContent).toContain('tra 3 e 9');
    expect(sleep.value).toBe('6');
  });

  it('refuses a decimal or an empty number', async () => {
    const { root, change } = await render();
    await change(input(root, 'Sonno corto'), '6.5');
    await change(input(root, 'Sonno corto'), '');
    http.expectNone(PUT);
  });

  it('says so and puts the old value back when the server does not answer', async () => {
    const { root, fixture, change } = await render();
    const sleep = input(root, 'Sonno corto');
    await change(sleep, '7');
    http.expectOne(PUT).error(new ProgressEvent('error'));
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(root.querySelector('.error')?.textContent).toContain('Non salvato');
    expect(sleep.value).toBe('6');
  });

  it('puts the defaults back with an empty set of values', async () => {
    const { root, fixture } = await render(view({ sleepHours: 8 }));
    root.querySelector<HTMLButtonElement>('.reset')!.click();
    // Prima si tolgono i parametri scelti a mano (impostazioni), poi parte la richiesta.
    await new Promise<void>((resolve) => setTimeout(resolve));
    const request = http.expectOne(PUT);
    expect(request.request.body).toEqual({ config: {} });
    request.flush(view());
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.componentRef.setInput('plugin', view());
    fixture.detectChanges();
    expect(input(root, 'Sonno corto').value).toBe('6');
  });

  describe('parameters linked to Obiettivi', () => {
    function linkedView(config: Record<string, unknown> = {}): PluginView {
      return {
        manifest: {
          id: 'circadian',
          name: 'Ritmo',
          description: '',
          version: '1',
          requires: [],
          config: [{ key: 'bedtime', label: 'Coricarsi abituale', type: 'TIME', defaultValue: '23:00', min: null, max: null }],
        },
        enabled: true,
        config: { bedtime: '23:30', ...config },
        result: null,
      };
    }

    it('shows the value from Obiettivi, read only, with a way to change it only here', async () => {
      const { root } = await render(linkedView());
      const field = root.querySelector('.field')!;
      expect(field.querySelector('input')).toBeNull();
      expect(field.querySelector('.value')?.textContent).toBe('23:30');
      expect(field.textContent).toContain('Da Obiettivi › Coricarsi');
      expect(field.querySelector('button')?.textContent).toContain('Cambia solo qui');
    });

    it('becomes editable after «Cambia solo qui», and can go back to Obiettivi', async () => {
      const { root, fixture } = await render(linkedView());
      root.querySelector<HTMLButtonElement>('.field button')!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      expect(root.querySelector('.field input[type="time"]')).not.toBeNull();
      expect(TestBed.inject(SettingsService).settings().pluginOverrides['circadian']).toEqual(['bedtime']);
      expect(root.querySelector('.field .source button')?.textContent).toContain('Usa quello di Obiettivi');
    });
  });
});
