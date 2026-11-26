import { Provider } from '@angular/core';
import { HeadacheEpisode } from './headache.model';
import { HeadacheRepository } from './headache.repository';
import { Clock } from './clock';
import { JournalEntry } from './journal.model';
import { JournalRepository } from './journal.repository';

/** Solo per i test: archivio in memoria e orologio fisso. */
export class InMemoryHeadacheRepository extends HeadacheRepository {
  saved: HeadacheEpisode[][] = [];

  constructor(private stored: HeadacheEpisode[] = []) {
    super();
  }

  async load(): Promise<HeadacheEpisode[]> {
    return this.stored;
  }

  async save(episodes: readonly HeadacheEpisode[]): Promise<void> {
    this.stored = [...episodes];
    this.saved.push([...episodes]);
  }
}

export class FakeClock extends Clock {
  constructor(public current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export class InMemoryJournalRepository extends JournalRepository {
  saved: JournalEntry[][] = [];

  constructor(private stored: JournalEntry[] = []) {
    super();
  }

  async load(): Promise<JournalEntry[]> {
    return this.stored;
  }

  async save(entries: readonly JournalEntry[]): Promise<void> {
    this.stored = [...entries];
    this.saved.push([...entries]);
  }
}

export function provideDiaryTesting(
  repository: HeadacheRepository,
  clock: Clock,
  journal: JournalRepository = new InMemoryJournalRepository(),
): Provider[] {
  return [
    { provide: HeadacheRepository, useValue: repository },
    { provide: JournalRepository, useValue: journal },
    { provide: Clock, useValue: clock },
  ];
}
