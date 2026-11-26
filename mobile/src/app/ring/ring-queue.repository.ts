import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { EMPTY_QUEUE, RingQueue, normalizeQueue } from './ring-queue.model';

/** Archivio locale della coda dell'anello (docs/adr/0018). */
export abstract class RingQueueRepository {
  abstract load(): Promise<RingQueue>;
  abstract save(queue: RingQueue): Promise<void>;
}

const PREFERENCE_NAME = 'ring-queue.v1';

@Injectable()
export class PreferencesRingQueueRepository extends RingQueueRepository {
  async load(): Promise<RingQueue> {
    const { value } = await Preferences.get({ key: PREFERENCE_NAME });
    if (!value) {
      return EMPTY_QUEUE;
    }
    try {
      return normalizeQueue(JSON.parse(value));
    } catch {
      return EMPTY_QUEUE;
    }
  }

  async save(queue: RingQueue): Promise<void> {
    await Preferences.set({ key: PREFERENCE_NAME, value: JSON.stringify(queue) });
  }
}

/** Solo per i test: coda in memoria. */
export class InMemoryRingQueueRepository extends RingQueueRepository {
  saved: RingQueue[] = [];

  constructor(private stored: RingQueue = EMPTY_QUEUE) {
    super();
  }

  async load(): Promise<RingQueue> {
    return this.stored;
  }

  async save(queue: RingQueue): Promise<void> {
    this.stored = queue;
    this.saved.push(queue);
  }
}
