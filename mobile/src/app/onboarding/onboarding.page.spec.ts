import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CredentialsRepository } from '../api/credentials.repository';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { InMemoryCredentialsRepository } from '../api/testing';
import { RingError } from '../ring/ring-source';
import { RingSourceProvider } from '../ring/ring-source.provider';
import { ScriptedRingSource } from '../ring/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { BluetoothAccess, BluetoothState } from '../ring/ble/bluetooth-access';
import { OnboardingPage } from './onboarding.page';

describe('OnboardingPage', () => {
  async function render() {
    const ring = new ScriptedRingSource();
    const bluetooth = { answer: 'granted' as BluetoothState, opened: [] as string[], request: async () => bluetooth.answer, openSettings: async (s: string) => void bluetooth.opened.push(s) };
    const repository = new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: 'https://ringlife.example.net' });
    await TestBed.configureTestingModule({
      imports: [OnboardingPage],
      providers: [
        provideRouter([]),
        { provide: SettingsRepository, useValue: repository },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
        { provide: BluetoothAccess, useValue: bluetooth },
        { provide: RingSourceProvider, useValue: { current: signal(ring) } },
        { provide: RingLifeApi, useValue: { healthRoute: async () => ({}), register: async () => undefined } },
      ],
    }).compileComponents();
    await TestBed.inject(SettingsService).init();
    await TestBed.inject(CredentialsService).init();
    const fixture = TestBed.createComponent(OnboardingPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, root, ring, button, settle, repository, bluetooth };
  }

  it('starts on the welcome step with the medical notice, one step out of eight', async () => {
    const { root } = await render();
    expect(root.querySelector('h1')?.textContent).toBe('Benvenuto');
    expect(root.textContent).toContain('non è un dispositivo medico');
    expect(root.querySelector('.progress')?.textContent).toContain('Passo 1 di 8');
  });

  it('does not let you past the server step until the phone is paired', async () => {
    const { root, button, settle } = await render();
    button('Inizia').click();
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Il tuo server');
    expect(button('Continua').disabled).toBe(true);
    expect(root.textContent).toContain('Collega il telefono al server per continuare.');

    await TestBed.inject(CredentialsService).savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    await settle();
    expect(button('Continua').disabled).toBe(false);
  });

  it('does not let you past the ring step until the ring answered, and shows why it did not', async () => {
    const { root, ring, button, settle } = await render();
    await TestBed.inject(CredentialsService).savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    button('Inizia').click();
    await settle();
    button('Continua').click();
    await settle();
    button('Consenti il Bluetooth').click();
    await settle();
    button('Continua').click();
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Il tuo anello');
    expect(button('Continua').disabled).toBe(true);

    ring.failAt = 'connect';
    ring.failWith = new RingError('ring_not_found');
    button("Cerca l'anello").click();
    await settle();
    expect(root.querySelector('.error')?.textContent).toContain("Non trovo l'anello");
    expect(button('Continua').disabled).toBe(true);

    ring.failAt = null;
    ring.batteryPercent = 71;
    button("Cerca l'anello").click();
    await settle();
    expect(root.querySelector('.ok')?.textContent).toContain('Batteria 71%');
    expect(button('Continua').disabled).toBe(false);
    expect(ring.calls.at(-1)).toBe('disconnect');
  });

  it('waits for the Bluetooth permission: denied or off keeps you here and says what to do', async () => {
    const { root, bluetooth, button, settle } = await render();
    await TestBed.inject(CredentialsService).savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    button('Inizia').click();
    await settle();
    button('Continua').click();
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Bluetooth');
    expect(button('Continua').disabled).toBe(true);

    bluetooth.answer = 'denied';
    button('Consenti il Bluetooth').click();
    await settle();
    expect(root.querySelector('.error')?.textContent).toContain('Il permesso è negato');
    expect(button('Continua').disabled).toBe(true);
    button('Apri le impostazioni').click();
    expect(bluetooth.opened).toEqual(['denied']);

    bluetooth.answer = 'off';
    button('Controlla di nuovo').click();
    await settle();
    expect(root.querySelector('.error')?.textContent).toContain('Il Bluetooth è spento');
    expect(button('Continua').disabled).toBe(true);

    bluetooth.answer = 'granted';
    button('Controlla di nuovo').click();
    await settle();
    expect(root.querySelector('.ok')?.textContent).toContain('Permesso dato');
    expect(button('Continua').disabled).toBe(false);
  });

  it('lets you go back to a step already done', async () => {
    const { root, button, settle } = await render();
    button('Inizia').click();
    await settle();
    button('Indietro').click();
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Benvenuto');
  });
});
