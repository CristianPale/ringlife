import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LogoComponent } from '../brand/logo.component';
import { StartupSyncService } from './startup-sync.service';

/** La schermata con il logo che copre l'app mentre si sincronizza all'apertura. */
@Component({
  selector: 'app-startup-loader',
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .loader {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      background: var(--rl-bg);
      color: var(--rl-text);
    }

    .status {
      margin: 0;
      font-size: 15px;
      color: var(--rl-text-2);
    }

    .skip {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--rl-chip-border);
      border-radius: 999px;
      background: transparent;
      color: var(--rl-text-2);
      font: inherit;
      font-size: 14px;
    }
  `,
  template: `
    @if (startup.visible()) {
      <div class="loader" role="status" aria-live="polite">
        <app-logo [size]="96" [animated]="true"></app-logo>
        <p class="status">{{ startup.label() }}</p>
        <button type="button" class="skip" (click)="startup.skip()">Salta</button>
      </div>
    }
  `,
})
export class StartupLoaderComponent {
  protected readonly startup = inject(StartupSyncService);
}
