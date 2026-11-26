import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Il marchio di RingLife: l'anello aperto con il punto. Il disegno è quello del kit del logo
 * (`docs/design/logo/kit/favicon.svg`, la versione robusta per le dimensioni piccole). L'anello prende il colore
 * del testo del tema, il punto il verde del marchio (`--rl-logo-dot`), cosi' si legge sul tema scuro e sul chiaro.
 * Con `wordmark` scrive anche il nome. Con `animated` l'anello gira piano e il punto pulsa (schermata di avvio).
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      color: var(--rl-text);
      line-height: 1;
    }

    svg {
      display: block;
      flex: none;
    }

    .spin {
      transform-origin: 128px 128px;
    }

    .ring {
      fill: currentColor;
    }

    .dot {
      fill: var(--rl-logo-dot);
      transform-origin: 185.98px 70.02px;
    }

    .name {
      font-weight: 700;
      letter-spacing: -0.3px;
    }

    .animated .spin {
      animation: ring-turn 2.4s cubic-bezier(0.55, 0.1, 0.35, 0.9) infinite;
    }

    .animated .dot {
      animation: dot-pulse 1.2s ease-in-out infinite;
    }

    @keyframes ring-turn {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes dot-pulse {
      50% {
        transform: scale(1.3);
        opacity: 0.8;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .animated .spin,
      .animated .dot {
        animation: none;
      }
    }
  `,
  template: `
    <svg
      viewBox="0 0 256 256"
      [attr.width]="size()"
      [attr.height]="size()"
      [class.animated]="animated()"
      [attr.aria-hidden]="wordmark() ? 'true' : null"
      [attr.role]="wordmark() ? null : 'img'"
      [attr.aria-label]="wordmark() ? null : 'RingLife'"
    >
      <g class="spin">
        <path
          class="ring"
          d="M232.97 142.75A106 106 0 1 1 113.25 23.03A24 24 0 0 1 119.93 70.56A58 58 0 1 0 185.44 136.07A24 24 0 0 1 232.97 142.75Z"
        />
        <circle class="dot" cx="185.98" cy="70.02" r="24" />
      </g>
    </svg>
    @if (wordmark()) {
      <span class="name" [style.font-size.px]="size() * 0.72">RingLife</span>
    }
  `,
})
export class LogoComponent {
  /** Lato del simbolo in pixel. */
  readonly size = input(28);
  readonly wordmark = input(false);
  readonly animated = input(false);
}
