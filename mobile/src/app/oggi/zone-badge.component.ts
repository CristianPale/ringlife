import { Component, input } from '@angular/core';
import { ZONE_LABELS, Zone } from './zone';

/** Zona di un indice: icona ed etichetta, mai solo colore (WCAG 1.4.1). */
@Component({
  selector: 'app-zone-badge',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
    }
    svg {
      width: 13px;
      height: 13px;
      fill: none;
      stroke: var(--zone-color);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    :host([data-zone='ottimo']) {
      --zone-color: var(--rl-zone-ottimo);
    }
    :host([data-zone='buono']) {
      --zone-color: var(--tile-text-2, var(--rl-text-2));
    }
    :host([data-zone='attenzione']) {
      --zone-color: var(--rl-zone-attenzione);
    }
    :host([data-zone='alto']) {
      --zone-color: var(--rl-zone-alto);
    }
  `,
  host: { '[attr.data-zone]': 'zone()' },
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (zone()) {
        @case ('ottimo') {
          <path d="M5 12l4 4 10-10"></path>
        }
        @case ('buono') {
          <circle cx="12" cy="12" r="8"></circle>
          <circle cx="12" cy="12" r="2" fill="currentColor" style="fill: var(--zone-color)"></circle>
        }
        @case ('attenzione') {
          <path d="M12 4l9 16H3z"></path>
          <path d="M12 10v4"></path>
        }
        @case ('alto') {
          <path d="M12 3l9 9-9 9-9-9z"></path>
          <path d="M12 8.5v4"></path>
        }
      }
    </svg>
    <span>{{ label() }}</span>
  `,
})
export class ZoneBadgeComponent {
  readonly zone = input.required<Zone>();

  protected label(): string {
    return ZONE_LABELS[this.zone()];
  }
}
