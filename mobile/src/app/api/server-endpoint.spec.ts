import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { ApiError } from './api-error';
import { HOME_ATTEMPT_TIMEOUT_MS, ServerEndpoint } from './server-endpoint';

const REMOTE = 'https://ringlife.example.net';
const HOME = 'http://192.168.1.20:8080';

describe('ServerEndpoint', () => {
  async function create(serverUrl = REMOTE, homeUrl = HOME) {
    TestBed.configureTestingModule({
      providers: [{ provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl, homeUrl }) }],
    });
    await TestBed.inject(SettingsService).init();
    return TestBed.inject(ServerEndpoint);
  }

  const offline = () => new ApiError('offline');

  it('tries the Tailscale address first and stops there when it answers', async () => {
    const endpoint = await create();
    const tried: string[] = [];
    const result = await endpoint.run(async (base) => {
      tried.push(base);
      return 'ok';
    });
    expect(tried).toEqual([REMOTE]);
    expect(result).toEqual({ value: 'ok', route: 'remote' });
  });

  it('falls back to the home address on a network error, with a short wait', async () => {
    const endpoint = await create();
    const waits: (number | null)[] = [];
    const result = await endpoint.run(async (base, timeoutMs) => {
      waits.push(timeoutMs);
      if (base === REMOTE) {
        throw offline();
      }
      return 'ok';
    });
    expect(result.route).toBe('home');
    expect(waits).toEqual([null, HOME_ATTEMPT_TIMEOUT_MS]);
  });

  it('does not switch address on an error that is not a network error', async () => {
    for (const kind of ['unauthorized', 'rejected', 'server', 'disabled'] as const) {
      TestBed.resetTestingModule();
      const endpoint = await create();
      const tried: string[] = [];
      await expect(
        endpoint.run(async (base) => {
          tried.push(base);
          throw new ApiError(kind);
        }),
      ).rejects.toMatchObject({ kind });
      expect(tried).toEqual([REMOTE]);
    }
  });

  it('gives the last network error when no address answers', async () => {
    const endpoint = await create();
    await expect(
      endpoint.run(async () => {
        throw offline();
      }),
    ).rejects.toMatchObject({ kind: 'offline' });
  });

  it('tries first the address that worked last', async () => {
    const endpoint = await create();
    await endpoint.run(async (base) => {
      if (base === REMOTE) {
        throw offline();
      }
      return 1;
    });
    const tried: string[] = [];
    await endpoint.run(async (base) => {
      tried.push(base);
      return 2;
    });
    expect(tried).toEqual([HOME]);
  });

  it('goes back to the other address when the preferred one stops answering', async () => {
    const endpoint = await create();
    await endpoint.run(async (base) => {
      if (base === REMOTE) {
        throw offline();
      }
      return 1;
    });
    const tried: string[] = [];
    const result = await endpoint.run(async (base) => {
      tried.push(base);
      if (base === HOME) {
        throw offline();
      }
      return 2;
    });
    expect(tried).toEqual([HOME, REMOTE]);
    expect(result.route).toBe('remote');
  });

  it('uses only the Tailscale address when no home address is set, with no wait limit', async () => {
    const endpoint = await create(REMOTE, '');
    const waits: (number | null)[] = [];
    await endpoint.run(async (_base, timeoutMs) => {
      waits.push(timeoutMs);
    });
    expect(endpoint.candidates()).toEqual([{ route: 'remote', base: REMOTE }]);
    expect(waits).toEqual([null]);
  });

  it('says not-configured when there is no Tailscale address, even with a home address', async () => {
    const endpoint = await create('', HOME);
    // L'indirizzo HTTPS è obbligatorio: senza, l'indirizzo di casa da solo non basta (docs/adr/0012).
    await expect(endpoint.run(async () => 1)).rejects.toMatchObject({ kind: 'not-configured' });
  });
});
