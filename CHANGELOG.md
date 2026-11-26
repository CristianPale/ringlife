# Novità di RingLife

Una sola versione per l'app sull'iPhone e per il server di casa (l'app di Home Assistant): ogni rilascio li porta alla stessa versione. Home Assistant mostra queste note quando c'è un aggiornamento, TestFlight in «Cosa testare», GitHub nella release. Come si rilascia: `docs/adr/0037-versione-unica-e-changelog.md`.

## Non rilasciata

### Novità

### Correzioni

## 1.1.0 — 26 novembre 2026

### Novità

- App Android: un APK firmato in ogni release. È disponibile ma non provata (la piattaforma provata resta iOS) e legge l'anello solo con l'app aperta.
### Correzioni

- Il rilascio pubblica di nuovo il codice nel repository pubblico: il controllo dei segreti scambiava per segreti i valori inventati dei test.

## 1.0.0 — 26 novembre 2026

### Novità

- Server di casa: nuova opzione `apns_topic` per ricevere le push con un'app costruita con un Bundle ID diverso da quello predefinito.

### Correzioni

- A ogni lettura l'app controlla che l'anello abbia ancora accese le misure scelte (battito, stress, ossigeno, HRV, temperatura) e le riaccende se le ha perse. Impostazioni › Anello dice quando è successo.
- Letture in background: se il tempo finisce sull'ultima richiesta, le misure già lette si tengono e si inviano, invece di perdere tutta la lettura.
- Un'automazione di Comandi non viene più interrotta dall'app che si avvia in background per eseguirla.

## 0.2.1 — 25 novembre 2026

### Correzioni

- La 0.2.0 non è arrivata a Home Assistant: il rilascio si era fermato su un controllo interno. La 0.2.1 contiene le stesse novità.

## 0.2.0 — 25 novembre 2026

### Novità

- Avvisi: il server di casa ti avvisa quando affaticamento, temperatura della notte, battito a riposo, HRV, respiro notturno, Recupero o rischio emicrania sono lontani dal tuo solito. Elenco dalla campanella in Oggi, notifiche con ore silenziose e testo breve sulla schermata bloccata, scelte in Impostazioni › Notifiche e nel primo avvio.
- Notifica se per 24 ore nessuno legge l'anello, anche con l'app chiusa.
- Oggi è più corta: giro, frase del giorno, indici e una riga per ogni plugin quotidiano con la sua sintesi (per esempio «Rischio basso»). Le card complete sono nella pagina del plugin.
- Nuova scheda Corpo: battito di oggi, temperatura, Misura ora, allenamento e respirazione, con i minuti di allenamento delle ultime 8 settimane.
- Andamento: nuova sezione «Le tue settimane» con Report settimanale, Jet lag sociale e Ritmo circadiano.
- Il Monitoraggio del battito diventa Allenamento: tipo di attività, zona obiettivo, pausa, recupero del battito dopo un minuto e calorie stimate dal battito.
- Server: ogni plugin dice se è quotidiano o settimanale e manda una sintesi di una riga del suo risultato.
- Nuova Guida: una pagina per ogni indice, misura e plugin, con come si calcola e come si legge. Si apre dal pulsante «i» accanto ai titoli o da Impostazioni › Guida.
- Guida: nuova pagina sul jet lag sociale, con cos'è, come lo calcola RingLife, un esempio e i limiti.
- Oggi: nuova sezione «Battito di oggi» con l'ultima misura dell'anello, il grafico della giornata (si legge al tocco) e il tuo battito a riposo di notte come riferimento.
- Impostazioni › Abitudini: la caffeina che prendi ogni giorno alla stessa ora. Il Diario la segna da sola; il giorno che salti, «Togli» nel Diario.
- Oggi dice quante notti mancano alla fine della calibrazione, e il Recupero spiega perché non c'è ancora.
- Versione unica e changelog per app e server, nelle note di Home Assistant, TestFlight e GitHub.
- Temperatura: «Misura ora» fa misurare l'anello adesso, in circa 30 secondi, al posto di «Leggi ora» che mostrava solo l'ultima misura automatica.
- Nuova pagina «Misura ora», da Oggi: battito, ossigeno nel sangue, HRV, stress e temperatura misurati adesso dall'anello.
- Letture in background: dopo ogni lettura l'app prova a inviare i dati al server e a controllare gli avvisi, senza aprirla. Con la lettura in background accesa, iOS legge anche una volta dopo il risveglio abituale.
- Avvisi tuoi: in Impostazioni › Notifiche costruisci fino a 20 avvisi da una misura, sopra o sotto la tua media o un valore, per quanti giorni di fila (per esempio «Passi sotto 3.000 per 3 giorni di fila»).
- Notifiche dal server di casa: con la chiave di Apple sul server, ogni avviso arriva appena il server lo calcola, anche con l'app chiusa. Il testo viaggia cifrato: Apple vede solo «Avviso di RingLife». Si accendono in Impostazioni › Notifiche dopo la configurazione una tantum (`docs/release/PUSH-CIFRATE.md`).
- Impostazioni › Anello e la Guida spiegano quali automazioni di Comandi creare per leggere l'anello a orario, con un pulsante che apre Comandi. Il registro delle letture in background dice se i dati sono arrivati al server.

### Correzioni

- Senza server per più giorni, con le letture in background, il telefono non scarta più le letture più vecchie dell'anello: la coda tiene mesi di dati e li invia appena il server torna.
- Fuori casa, con il server di casa irraggiungibile, l'app non mostra più tutto vuoto: tiene gli ultimi dati scaricati, dice di quando sono e aggiunge i passi di oggi e la notte appena letti dall'anello. Tornati a casa, invia e si riallinea da sola.
- «Salta» all'apertura annulla davvero la lettura: non cerca più l'anello, non prova il server e non mostra la finestra d'errore.
- Schede dei plugin: le righe con un valore lungo (per esempio nel Jet lag sociale) non stringono più le etichette delle altre righe.
- Sonno: una notte letta prima del risveglio (in background o tornando nell'app) ora arriva intera con la lettura del mattino, invece di fermarsi all'ora della lettura. La prima lettura dopo l'aggiornamento ripara le notti che l'anello conserva ancora.
- Aggiornamento del server: lo script fa rileggere le app al Supervisor con `ha store reload`, e rilanciato dopo un errore riprova invece di dire «Già aggiornato».

## 0.1.0

Le versioni di prova fino al 23 novembre 2026, senza elenco delle novità.
