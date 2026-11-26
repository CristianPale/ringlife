import { Routes } from '@angular/router';
import { onboardingGuard } from './onboarding/onboarding.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tabs/oggi' },
  {
    // Assistente di prima configurazione: l'unica pagina aperta finché non è finito (docs/adr/0022).
    path: 'benvenuto',
    loadComponent: () => import('./onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: 'tabs',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'oggi' },
      {
        path: 'oggi',
        loadComponent: () => import('./oggi/oggi.page').then((m) => m.OggiPage),
      },
      {
        path: 'sonno',
        loadComponent: () => import('./sonno/sonno.page').then((m) => m.SonnoPage),
      },
      {
        // Corpo (docs/adr/0041): battito di oggi, temperatura, Misura ora, allenamento e respirazione.
        path: 'corpo',
        loadComponent: () => import('./corpo/corpo.page').then((m) => m.CorpoPage),
      },
      {
        path: 'diario',
        loadComponent: () => import('./diary/diario.page').then((m) => m.DiarioPage),
      },
      {
        path: 'andamento',
        loadComponent: () => import('./andamento/andamento.page').then((m) => m.AndamentoPage),
      },
    ],
  },
  {
    // Dettaglio degli indici: si apre dalle tile di Oggi, fuori dalle schede.
    path: 'indici/recupero',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./indici/recupero-detail.page').then((m) => m.RecuperoDetailPage),
  },
  {
    path: 'indici/stress',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./indici/stress-detail.page').then((m) => m.StressDetailPage),
  },
  {
    path: 'indici/movimento',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./indici/movimento-detail.page').then((m) => m.MovimentoDetailPage),
  },
  {
    // Temperatura: ultima misura, misure di oggi e «Misura ora» (docs/adr/0033).
    path: 'temperatura',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./temperatura/temperatura.page').then((m) => m.TemperaturaPage),
  },
  {
    // Misura ora: battito, ossigeno, HRV, stress e temperatura a comando (docs/adr/0039).
    path: 'misura',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./misura/misura.page').then((m) => m.MisuraPage),
  },
  {
    // Storico delle sessioni di battito dal vivo (docs/adr/0024), e il dettaglio di una.
    path: 'sessioni',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./session/session-history.page').then((m) => m.SessionHistoryPage),
  },
  {
    path: 'sessioni/:id',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./session/session-detail.page').then((m) => m.SessionDetailPage),
  },
  {
    // Sessione a schermo intero (docs/adr/0024, docs/adr/0042): `respirazione` o `allenamento` (`battito` è il nome vecchio).
    path: 'sessione/:mode',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./session/session.page').then((m) => m.SessionPage),
  },
  {
    // Avvisi (docs/adr/0045): l'elenco, dalla campanella in Oggi e dal tocco su una notifica.
    path: 'avvisi',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./avvisi/avvisi.page').then((m) => m.AvvisiPage),
  },
  {
    // Guida (docs/adr/0040): l'elenco e una pagina per argomento, dai pulsanti «i» e da Impostazioni. Senza guardia:
    // non mostra dati, quindi si può aprire anche dall'assistente di prima configurazione.
    path: 'guida',
    loadComponent: () => import('./guida/guida.page').then((m) => m.GuidaPage),
  },
  {
    path: 'guida/:topic',
    loadComponent: () => import('./guida/guida.page').then((m) => m.GuidaPage),
  },
  {
    // La pagina di un plugin si apre da «Dettagli» in Oggi.
    path: 'plugin/:id',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./plugins/plugin.page').then((m) => m.PluginPage),
  },
  {
    // Impostazioni si apre dal pulsante anello in Oggi, fuori dalle schede: un elenco e una pagina per sezione.
    path: 'impostazioni',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'impostazioni/:section',
    canActivate: [onboardingGuard],
    loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
  },
];
