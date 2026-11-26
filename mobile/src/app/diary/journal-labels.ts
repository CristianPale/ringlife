import { ChipOption } from '../shared/chip-group.component';
import { AlcoholDrink, CaffeineDrink, JournalEntry } from './journal.model';

export const CAFFEINE_OPTIONS: readonly ChipOption[] = [
  { code: 'coffee', label: 'Caffè' },
  { code: 'tea', label: 'Tè' },
  { code: 'energy', label: 'Energy drink' },
  { code: 'other', label: 'Altro' },
];

export const ALCOHOL_OPTIONS: readonly ChipOption[] = [
  { code: 'wine', label: 'Vino' },
  { code: 'beer', label: 'Birra' },
  { code: 'spirits', label: 'Superalcolico' },
  { code: 'other', label: 'Altro' },
];

const CAFFEINE_TEXT: Record<CaffeineDrink, string> = {
  coffee: '1 caffè',
  tea: '1 tè',
  energy: '1 energy drink',
  other: '1 bevanda con caffeina',
};

const ALCOHOL_TEXT: Record<AlcoholDrink, string> = {
  wine: '1 bicchiere di vino',
  beer: '1 birra',
  spirits: '1 superalcolico',
  other: '1 bevanda alcolica',
};

/** «1 caffè», «1 tè». */
export function caffeineServing(drink: CaffeineDrink): string {
  return CAFFEINE_TEXT[drink];
}

/** «Caffeina · 1 caffè», «Alcol · 1 bicchiere di vino», «Nota · testo». */
export function journalText(entry: JournalEntry): string {
  switch (entry.kind) {
    case 'caffeine':
      return `Caffeina · ${CAFFEINE_TEXT[entry.drink]}`;
    case 'alcohol':
      return `Alcol · ${ALCOHOL_TEXT[entry.drink]}`;
    case 'note':
      return `Nota · ${entry.text}`;
  }
}

/** Frase di conferma dopo il tocco: «Caffeina registrata: 1 caffè». */
export function confirmationText(entry: JournalEntry): string {
  switch (entry.kind) {
    case 'caffeine':
      return `Caffeina registrata: ${CAFFEINE_TEXT[entry.drink]}`;
    case 'alcohol':
      return `Alcol registrato: ${ALCOHOL_TEXT[entry.drink]}`;
    case 'note':
      return 'Nota registrata';
  }
}
