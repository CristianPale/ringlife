import { Component, input } from '@angular/core';

/**
 * Pagina senza dati ancora: il telefono è collegato a un server, ma il server non ha ancora calcolato questo risultato.
 * Mai valori d'esempio al posto dei veri.
 */
@Component({
  selector: 'app-no-data',
  styles: [
    `
      :host {
        display: block;
        padding: calc(var(--ion-safe-area-top, 0px) + 24px) var(--rl-gutter) 120px;
        color: var(--rl-text);
      }
      h1 {
        margin: 0 0 12px;
        font-family: var(--rl-font-voice);
        font-size: 28px;
        line-height: 34px;
        font-weight: 500;
      }
      p {
        margin: 0 0 8px;
        font-size: 15px;
        line-height: 22px;
        color: var(--rl-text-2);
      }
    `,
  ],
  template: `
    <h1>{{ title() }}</h1>
    <p>{{ lead() }}</p>
    <p>{{ hint() }}</p>
  `,
})
export class NoDataComponent {
  readonly title = input('');
  readonly lead = input('Nessun dato ancora.');
  readonly hint = input('Compare dopo la prossima sincronizzazione dell\'anello, quando il server ha calcolato il risultato.');
}
