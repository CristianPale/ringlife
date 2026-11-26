import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GUIDE, GuideTopicId } from './guide';

/**
 * Il pulsante «i» accanto a un titolo (docs/adr/0040): apre la pagina della Guida che spiega quella cosa. Il cerchio è
 * piccolo, ma l'area di tocco è 44 × 44 px; i margini negativi non fanno crescere la riga del titolo.
 */
@Component({
  selector: 'app-info',
  imports: [RouterLink],
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
      margin: -10px -8px -10px -4px;
    }

    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      color: var(--rl-muted);
      border-radius: 50%;
    }

    a:focus-visible {
      outline: 2px solid var(--rl-text);
      outline-offset: -6px;
    }

    svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
    }

    .dot {
      fill: currentColor;
      stroke: none;
    }
  `,
  template: `
    <a [routerLink]="['/guida', topic()]" [attr.aria-label]="label()">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.2"></circle>
        <path d="M10 9v5"></path>
        <circle class="dot" cx="10" cy="6.3" r="1.05"></circle>
      </svg>
    </a>
  `,
})
export class InfoLinkComponent {
  readonly topic = input.required<GuideTopicId>();

  protected readonly label = computed(() => `Guida: ${GUIDE[this.topic()].title}`);
}
