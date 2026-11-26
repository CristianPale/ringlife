import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identita' app sugli store: NON cambiare dopo la prima pubblicazione.
  appId: 'com.ringlife.app',
  appName: 'RingLife',
  webDir: 'www',
  // Zoom del WebView spento (pinch). Il doppio tocco lo blocca il viewport.
  zoomEnabled: false,
  plugins: {
    // Le chiamate al backend passano dal codice nativo: dal WebView (capacitor://localhost) il browser
    // le bloccherebbe per CORS, e il backend non apre CORS a nessuna origine.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
