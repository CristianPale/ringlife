import { Component, computed, effect, input, signal } from '@angular/core';
import { GIRO_CENTER, GIRO_RADIUS, GIRO_SIZE, GiroData, arcPath, describeGiro, pointAt, tickLine } from './giro';
import { Direction, STANDING_LABELS, livellaLayout, standingOf } from './livella';

/** L'indice al centro del giro: nome, numero e scostamento dalla tua media. */
export interface GiroCenter {
  label: string;
  /** `null` quando l'indice non c'è ancora: il centro mostra un trattino. */
  value: number | null;
  deviation: number | null;
  direction?: Direction;
}

/** Quanto dura l'apertura, ultima bolla compresa: poi il giro torna statico. */
const PLAY_MS = 2700;
const CENTER_TUBE_WIDTH = 96;
const CENTER_TUBE_X = GIRO_CENTER - CENTER_TUBE_WIDTH / 2;

/**
 * Il giro delle 24 ore (ADR 0020), in testa a Oggi. Fascia chiara tra due tacche: il tuo orario abituale di sonno.
 * Arco blu: il sonno di stanotte. Arco sottile chiaro: la finestra caffeina. Bolla verde: adesso.
 * Al centro l'indice, con la stessa livella delle righe.
 */
@Component({
  selector: 'app-giro',
  host: { '[class.play]': 'playing()', '[class.wait]': 'waiting()' },
  styles: `
    /* Il disegno è su una griglia di 216 punti e si ingrandisce: tutto il giro scala insieme, testo compreso. */
    :host {
      display: block;
      width: min(100%, var(--giro-size, 280px));
      line-height: 0;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .ring {
      fill: none;
      stroke: var(--rl-tube);
      stroke-width: 12;
    }
    .usual-arc {
      fill: none;
      stroke: var(--rl-usual);
      stroke-width: 12;
    }
    .caffeine-arc {
      fill: none;
      stroke: var(--rl-text-2);
      stroke-width: 4;
      stroke-linecap: round;
    }
    .sleep-arc {
      fill: none;
      stroke: var(--rl-stage-light);
      stroke-width: 6;
      stroke-linecap: round;
    }
    .tick {
      stroke: var(--rl-mark);
      stroke-width: 2;
      stroke-linecap: round;
    }
    .now {
      fill: var(--rl-ok);
      stroke: var(--rl-bg);
      stroke-width: 2.5;
    }
    text {
      font-family: var(--rl-font-text);
    }
    .hour {
      fill: var(--rl-muted);
      font-size: 11px;
      font-family: var(--rl-font-mono);
    }
    .name {
      fill: var(--rl-text-2);
      font-size: 13px;
    }
    .value {
      fill: var(--rl-text);
      font-size: 52px;
      font-weight: 500;
      letter-spacing: -2px;
      font-family: var(--rl-font-mono);
    }
    .standing {
      fill: var(--rl-text-2);
      font-size: 13px;
    }
    .standing.peggio {
      fill: var(--rl-warn);
    }
    .standing.meglio {
      fill: var(--rl-ok-text);
    }
    .tube {
      fill: var(--rl-tube);
    }
    .usual {
      fill: var(--rl-usual);
    }
    .mark {
      fill: var(--rl-mark);
    }
    .bubble {
      fill: var(--rl-ok);
      stroke: var(--rl-bg);
      stroke-width: 2;
    }
    .bubble.peggio {
      fill: var(--rl-warn);
    }

    /*
     * Apertura (solo senza «riduci movimento»): il giro si apre dal centro e si disegna, poi arrivano archi, centro e
     * bolla. Una volta sola in tutta la sessione dell'app: la prima istanza lo anima, le altre nascono già complete.
     * La velocità segue una curva a campana (gaussiana): parte lenta, accelera, rallenta. la variabile --giro-ease è la posizione che
     * ne risulta (funzione degli errori), con un'approssimazione per i telefoni senza linear().
     */
    @media (prefers-reduced-motion: no-preference) {
      :host {
        --giro-ease: cubic-bezier(0.65, 0, 0.35, 1);
      }
      @supports (animation-timing-function: linear(0, 1)) {
        :host {
          --giro-ease: linear(0, 0.0006, 0.002, 0.0051, 0.0115, 0.0235, 0.0445, 0.0784, 0.1287, 0.1979, 0.2857, 0.3886, 0.5, 0.6114, 0.7143, 0.8021, 0.8713, 0.9216, 0.9555, 0.9765, 0.9885, 0.9949, 0.998, 0.9994, 1);
        }
      }
      /* Prima del via il giro non si vede: parte quando il caricamento è finito o saltato. */
      :host(.wait) svg {
        opacity: 0;
      }
      :host(.play) svg {
        animation: giro-open 1500ms var(--giro-ease) both;
      }
      :host(.play) .ring {
        stroke-dasharray: 604;
        stroke-dashoffset: 604;
        transform: rotate(-90deg);
        transform-origin: 108px 108px;
        animation: giro-draw 1600ms var(--giro-ease) 100ms forwards;
      }
      :host(.play) .usual-arc,
      :host(.play) .sleep-arc,
      :host(.play) .caffeine-arc {
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        /* La dissolvenza breve tiene nascosto l'arco finché non tocca a lui: senza, il capo tondo lascia un punto. */
        animation:
          giro-draw 1000ms var(--giro-ease) forwards,
          giro-fade 120ms linear both;
      }
      :host(.play) .usual-arc {
        animation-delay: 900ms;
      }
      :host(.play) .sleep-arc {
        animation-delay: 1200ms;
      }
      :host(.play) .caffeine-arc {
        animation-delay: 1450ms;
      }
      :host(.play) .tick,
      :host(.play) .hour,
      :host(.play) .center {
        animation: giro-fade 600ms ease-out both;
      }
      :host(.play) .hour {
        animation-delay: 800ms;
      }
      :host(.play) .center {
        animation-delay: 1000ms;
      }
      :host(.play) .tick {
        animation-delay: 1500ms;
      }
      :host(.play) .now {
        transform-box: fill-box;
        transform-origin: center;
        animation: giro-pop 450ms cubic-bezier(0.2, 1.4, 0.4, 1) 1900ms both;
      }
    }

    @keyframes giro-open {
      from {
        opacity: 0;
        transform: scale(0.72);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes giro-draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes giro-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes giro-pop {
      from {
        opacity: 0;
        transform: scale(0);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `,
  template: `
    <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size" role="img" [attr.aria-label]="description()">
      <circle class="ring" [attr.cx]="middle" [attr.cy]="middle" [attr.r]="radius"></circle>
      @if (giro().usual; as usual) {
        <path class="usual-arc" pathLength="1" [attr.d]="arc(usual)"></path>
      }
      @if (giro().caffeine; as caffeine) {
        <path class="caffeine-arc" pathLength="1" [attr.d]="arc(caffeine)"></path>
      }
      @if (giro().sleep; as sleep) {
        <path class="sleep-arc" pathLength="1" [attr.d]="arc(sleep)"></path>
      }
      @if (ticks(); as t) {
        <line class="tick" [attr.x1]="t[0].x1" [attr.y1]="t[0].y1" [attr.x2]="t[0].x2" [attr.y2]="t[0].y2"></line>
        <line class="tick" [attr.x1]="t[1].x1" [attr.y1]="t[1].y1" [attr.x2]="t[1].x2" [attr.y2]="t[1].y2"></line>
      }
      <circle class="now" [attr.cx]="now().x" [attr.cy]="now().y" r="7"></circle>

      <text class="hour" x="108" y="38" text-anchor="middle">0</text>
      <text class="hour" x="180" y="112" text-anchor="middle">6</text>
      <text class="hour" x="108" y="188" text-anchor="middle">12</text>
      <text class="hour" x="36" y="112" text-anchor="middle">18</text>

      <g class="center">
        <text class="name" x="108" y="70" text-anchor="middle">{{ center().label }}, su 100</text>
        <text class="value" x="108" y="122" text-anchor="middle">{{ center().value ?? '–' }}</text>
        @if (tube(); as tube) {
          <rect class="tube" [attr.x]="tubeX" y="134" [attr.width]="tubeWidth" height="8" rx="4"></rect>
          <rect class="usual" [attr.x]="tubeX + tube.usualX" y="134" [attr.width]="tube.usualWidth" height="8"></rect>
          <rect class="mark" [attr.x]="tubeX + tube.markLeft - 1" y="131" width="2" height="14" rx="1"></rect>
          <rect class="mark" [attr.x]="tubeX + tube.markRight - 1" y="131" width="2" height="14" rx="1"></rect>
          @if (tube.bubbleX !== null) {
            <circle class="bubble" [class.peggio]="standing() === 'peggio'" [attr.cx]="tubeX + tube.bubbleX" cy="138" r="4.5"></circle>
          }
        }
        <text class="standing" [class.peggio]="standing() === 'peggio'" [class.meglio]="standing() === 'meglio'" x="108" y="164" text-anchor="middle">{{ standingText() }}</text>
      </g>
    </svg>
  `,
})
export class GiroComponent {
  readonly giro = input.required<GiroData>();
  readonly center = input.required<GiroCenter>();
  /** Fa partire l'animazione di apertura. Oggi lo alza quando il caricamento iniziale è finito o saltato. */
  readonly play = input(true);

  /** Il primo giro creato in questa sessione dell'app è quello che si anima: gli altri nascono già completi. */
  private static claimed = false;
  /** Solo per i test: rimette «nessuno ha ancora animato». */
  static resetForTests(): void {
    GiroComponent.claimed = false;
  }

  private readonly owner = !GiroComponent.claimed;
  private readonly begun = signal(false);
  protected readonly playing = signal(false);
  /** In attesa del via: il giro non si vede ancora. */
  protected readonly waiting = computed(() => this.owner && !this.begun());

  constructor() {
    GiroComponent.claimed = true;
    effect(() => {
      if (this.owner && this.play() && !this.begun()) {
        this.begun.set(true);
        this.playing.set(true);
        // Finita l'apertura si toglie la classe: gli elementi che compaiono dopo (centro che cambia) non rianimano.
        setTimeout(() => this.playing.set(false), PLAY_MS);
      }
    });
  }

  protected readonly size = GIRO_SIZE;
  protected readonly radius = GIRO_RADIUS;
  protected readonly middle = GIRO_CENTER;
  protected readonly tubeX = CENTER_TUBE_X;
  protected readonly tubeWidth = CENTER_TUBE_WIDTH;

  protected readonly arc = arcPath;
  protected readonly now = computed(() => pointAt(this.giro().nowMin));
  protected readonly ticks = computed(() => {
    const usual = this.giro().usual;
    return usual ? ([tickLine(usual.startMin), tickLine(usual.endMin)] as const) : null;
  });
  protected readonly tube = computed(() => {
    const deviation = this.center().deviation;
    return deviation === null ? null : livellaLayout(CENTER_TUBE_WIDTH, deviation, 4.5);
  });
  protected readonly standing = computed(() => {
    const { deviation, direction } = this.center();
    return deviation === null ? null : standingOf(deviation, direction ?? 'up');
  });
  protected readonly standingText = computed(() => {
    const standing = this.standing();
    return standing === null ? 'In calibrazione' : STANDING_LABELS[standing];
  });
  protected readonly description = computed(() =>
    describeGiro(
      this.giro(),
      this.center().value === null
        ? `${this.center().label}: nessun dato ancora.`
        : `${this.center().label} ${this.center().value} su 100, ${this.standingText().toLowerCase()}.`,
    ),
  );
}
