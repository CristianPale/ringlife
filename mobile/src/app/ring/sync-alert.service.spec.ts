import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ApiError } from '../api/api-error';
import { RingSyncService } from './ring-sync.service';
import { SyncAlertService } from './sync-alert.service';

describe('SyncAlertService', () => {
  function setup() {
    const ring = {
      ringError: signal<string | null>(null),
      uploadError: signal<ApiError | null>(null),
      settingsError: signal<string | null>(null),
      sync: vi.fn(async (): Promise<void> => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: RingSyncService, useValue: ring }] });
    return { ring, alerts: TestBed.inject(SyncAlertService) };
  }

  it('has nothing to say when the sync went well', () => {
    const { alerts } = setup();
    alerts.check();
    expect(alerts.problems()).toBeNull();
  });

  it('lists every problem in plain Italian, one per line', () => {
    const { ring, alerts } = setup();
    ring.ringError.set("L'anello non ha risposto in tempo.");
    ring.uploadError.set(new ApiError('offline'));
    ring.settingsError.set('Anello occupato.');
    alerts.check();
    const problems = alerts.problems()!;
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("L'anello non ha risposto");
    expect(problems[1]).toMatch(/^Invio al server: /);
    expect(problems[2]).toContain('Misure non scritte sull\'anello');
  });

  it('closes on dismiss', () => {
    const { ring, alerts } = setup();
    ring.ringError.set('x');
    alerts.check();
    alerts.dismiss();
    expect(alerts.problems()).toBeNull();
  });

  it('retries: closes, syncs again, and reopens only if it still fails', async () => {
    const { ring, alerts } = setup();
    ring.ringError.set('x');
    alerts.check();
    ring.sync.mockImplementation(async () => ring.ringError.set(null));
    await alerts.retry();
    expect(ring.sync).toHaveBeenCalledOnce();
    expect(alerts.problems()).toBeNull();

    ring.sync.mockImplementation(async () => ring.ringError.set('ancora no'));
    await alerts.retry();
    expect(alerts.problems()).toEqual(['ancora no']);
  });
});
