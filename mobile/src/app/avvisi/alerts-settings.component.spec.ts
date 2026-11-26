import { ComponentRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertsConfig } from './alerts.model';
import { AlertsService } from './alerts.service';
import { AlertsSettingsComponent } from './alerts-settings.component';
import { PushService } from './push.service';

const METRICS: AlertsConfig['metrics'] = [
  { id: 'resting_hr', name: 'Battito a riposo', unit: 'battiti al minuto', night: true, average: true, value: { min: 30, max: 120, step: 1 } },
  { id: 'steps', name: 'Passi', unit: 'passi', night: false, average: false, value: { min: 500, max: 30000, step: 500 } },
];

const CONFIG: AlertsConfig = {
  settings: { quietStart: '22:30', quietEnd: '07:00', lockScreen: 'breve', homeAssistant: false },
  rules: [
    {
      id: 'temperature',
      name: 'Temperatura della notte',
      description: 'Quando la temperatura della notte è sopra il tuo solito.',
      level: 'attenzione',
      usesAverage: true,
      params: { sensitivity: true, days: { min: 1, max: 5 }, threshold: null },
      enabled: true,
      sensitivity: 'normale',
      days: 2,
      threshold: null,
      delivery: 'notifica',
    },
    {
      id: 'sleep-debt',
      name: 'Debito di sonno',
      description: 'Quando il debito di sonno supera la soglia.',
      level: 'attenzione',
      usesAverage: false,
      params: { sensitivity: false, days: null, threshold: { unit: 'ore', min: 1, max: 20, step: 0.5 } },
      enabled: false,
      sensitivity: null,
      days: null,
      threshold: 6,
      delivery: 'notifica',
    },
    {
      id: 'steps-low',
      name: 'Passi bassi',
      description: 'Quando i passi restano sotto la soglia.',
      level: 'attenzione',
      usesAverage: false,
      params: { sensitivity: false, days: { min: 1, max: 7 }, threshold: { unit: 'passi', min: 500, max: 20000, step: 500 } },
      enabled: false,
      sensitivity: null,
      days: 3,
      threshold: 4000,
      delivery: 'notifica',
    },
  ],
};

describe('AlertsSettingsComponent', () => {
  async function render(wizard: boolean, saves = true, initial: AlertsConfig = CONFIG) {
    const config = signal<AlertsConfig | null>(null);
    const saveConfig = vi.fn(async () => saves);
    const addCustom = vi.fn(async () => saves);
    const updateCustom = vi.fn(async () => saves);
    const removeCustom = vi.fn(async () => saves);
    const loadConfig = vi.fn(async () => {
      config.set(initial);
      return true;
    });
    const push = {
      enabled: signal(false),
      status: signal(null),
      problem: signal<string | null>(null),
      busy: signal(false),
      enable: vi.fn(async () => push.problem.set('not_configured')),
      disable: vi.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [AlertsSettingsComponent],
      providers: [
        { provide: AlertsService, useValue: { config, saveConfig, loadConfig, addCustom, updateCustom, removeCustom } },
        { provide: PushService, useValue: push },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AlertsSettingsComponent);
    (fixture.componentRef as ComponentRef<AlertsSettingsComponent>).setInput('wizard', wizard);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, saveConfig, addCustom, updateCustom, removeCustom, push, fixture };
  }

  it('in the wizard proposes quiet hours and thresholds from the goals', async () => {
    const { saveConfig, root } = await render(true);
    // Obiettivi predefiniti: a letto alle 23:30, sveglia alle 07:00, 8 ore di sonno, 8000 passi.
    expect(saveConfig).toHaveBeenCalledWith({
      settings: { quietStart: '23:00', quietEnd: '07:00' },
      rules: { 'sleep-debt': { threshold: 6 }, 'steps-low': { threshold: 4000 } },
    });
    expect(root.textContent).not.toContain('Anello non letto da 24 ore');
  });

  it('shows the options of an enabled rule, says when it starts, and saves every change', async () => {
    const { root, saveConfig, fixture } = await render(false);
    expect(saveConfig).not.toHaveBeenCalled();
    expect(root.textContent).toContain("parte dall'ottava notte");
    const options = root.querySelector('[aria-label="Opzioni di Temperatura della notte"]')!;
    expect(options.textContent).toContain('Sensibilità');
    Array.from(options.querySelectorAll<HTMLButtonElement>('.chip'))
      .find((c) => c.textContent?.trim() === 'Sensibile')!
      .click();
    fixture.detectChanges();
    expect(saveConfig).toHaveBeenCalledWith({ rules: { temperature: { sensitivity: 'sensibile' } } });
    expect(root.querySelector('[aria-label="Opzioni di Debito di sonno"]')).toBeNull();
    expect(root.textContent).toContain('Anello non letto da 24 ore');
  });

  it('says when the server did not save', async () => {
    const { root, fixture } = await render(false, false);
    root.querySelector<HTMLButtonElement>('app-switch-row button')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(root.querySelector('.error')?.textContent).toContain('Non salvato');
  });

  it('hides «I tuoi avvisi» with a server that has no catalogue', async () => {
    const { root } = await render(false);
    expect(root.textContent).not.toContain('I tuoi avvisi');
  });

  it('hides «I tuoi avvisi» in the wizard', async () => {
    const { root } = await render(true, true, { ...CONFIG, metrics: METRICS, custom: [], maxCustom: 20 });
    expect(root.textContent).not.toContain('I tuoi avvisi');
  });

  it('builds a rule with a live name preview and creates it on the server (docs/adr/0046)', async () => {
    const { root, addCustom, fixture } = await render(false, true, { ...CONFIG, metrics: METRICS, custom: [], maxCustom: 20 });
    expect(root.textContent).toContain('I tuoi avvisi');
    const button = (text: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button.button')).find((b) => b.textContent?.trim() === text)!;
    button('Aggiungi un avviso').click();
    fixture.detectChanges();
    const builder = root.querySelector('[aria-label="Nuovo avviso"]')!;
    const metric = builder.querySelector<HTMLSelectElement>('select')!;
    metric.value = 'steps';
    metric.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const amount = builder.querySelector<HTMLInputElement>('input[type="number"]')!;
    amount.value = '3000';
    amount.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(builder.querySelector('.preview')?.textContent).toBe('Passi sotto 3.000 per 3 giorni di fila');
    button("Crea l'avviso").click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(addCustom).toHaveBeenCalledWith({
      metric: 'steps',
      comparison: 'below',
      amount: 3000,
      days: 3,
      level: 'attenzione',
      delivery: 'notifica',
      enabled: true,
    });
    expect(root.querySelector('[aria-label="Nuovo avviso"]')).toBeNull();
  });

  it('switches, changes delivery and removes an existing rule', async () => {
    const custom = [
      {
        id: 'custom-0a1b2c3d',
        name: 'Passi sotto 3.000 per 3 giorni di fila',
        metric: 'steps',
        comparison: 'below' as const,
        amount: 3000,
        days: 3,
        level: 'attenzione' as const,
        delivery: 'notifica' as const,
        enabled: true,
      },
    ];
    const { root, updateCustom, removeCustom } = await render(false, true, { ...CONFIG, metrics: METRICS, custom, maxCustom: 1 });
    root.querySelector<HTMLButtonElement>('[aria-label="Togli l\'avviso: Passi sotto 3.000 per 3 giorni di fila"]')!.click();
    expect(removeCustom).toHaveBeenCalledWith('custom-0a1b2c3d');
    const options = root.querySelector('[aria-label="Opzioni di Passi sotto 3.000 per 3 giorni di fila"]')!;
    Array.from(options.querySelectorAll<HTMLButtonElement>('.chip'))
      .find((c) => c.textContent?.trim() === "Solo nell'elenco")!
      .click();
    expect(updateCustom).toHaveBeenCalledWith('custom-0a1b2c3d', { delivery: 'elenco' });
    expect(root.textContent).toContain('Al massimo 1 avvisi tuoi');
  });

  it('turns the server push on and says when the iPhone is not set up for it (docs/adr/0047)', async () => {
    const { root, push, fixture } = await render(false);
    const section = root.querySelector('[aria-labelledby="avvisi-push"]')!;
    expect(section.textContent).toContain('Spente');
    Array.from(section.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Attiva')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(push.enable).toHaveBeenCalled();
    expect(section.textContent).toContain('manca la configurazione di Apple');
  });

  it('has no push section in the wizard', async () => {
    const { root } = await render(true);
    expect(root.querySelector('[aria-labelledby="avvisi-push"]')).toBeNull();
  });
});
