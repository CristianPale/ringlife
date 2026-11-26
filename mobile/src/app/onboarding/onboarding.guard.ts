import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SettingsService } from '../settings/settings.service';

/**
 * Sul telefono non si entra nell'app finché l'assistente di prima configurazione non è finito (docs/adr/0022).
 * Nel browser (dashboard sotto Ingress) non c'è assistente: la guardia lascia passare.
 */
export const onboardingGuard: CanActivateFn = () => {
  if (!Capacitor.isNativePlatform() || inject(SettingsService).settings().onboarded) {
    return true;
  }
  return inject(Router).createUrlTree(['/benvenuto']);
};
