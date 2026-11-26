/**
 * La Guida (docs/adr/0040): una pagina per ogni concetto dell'app, raggiungibile dall'elenco `/guida` e dai pulsanti
 * «i» accanto ai titoli (`InfoLinkComponent`). Testi in italiano semplice, coerenti con le formule di `docs/scores.md`:
 * se una formula cambia, cambia anche la sua pagina.
 */

export type GuideGroupId = 'indici' | 'misure' | 'sonno' | 'plugin' | 'app';

export const GUIDE_GROUPS: readonly { id: GuideGroupId; title: string }[] = [
  { id: 'indici', title: 'Gli indici' },
  { id: 'misure', title: "Le misure dell'anello" },
  { id: 'sonno', title: 'Il sonno' },
  { id: 'plugin', title: 'I plugin' },
  { id: 'app', title: "Usare l'app" },
];

export interface GuideSection {
  heading?: string;
  paragraphs: readonly string[];
}

export interface GuideTopic {
  group: GuideGroupId;
  title: string;
  /** In una o due frasi: compare in cima alla pagina e nell'elenco. */
  lead: string;
  sections: readonly GuideSection[];
  /** Altre pagine della Guida, per id. */
  related?: readonly string[];
}

export const GUIDE = {
  // ── Gli indici ────────────────────────────────────────────────────────────────────────────────────────────────
  'come-leggere': {
    group: 'indici',
    title: 'Come leggere gli indici',
    lead: 'Ogni indice va da 0 a 100 e più alto è meglio. La livella accanto dice come stai rispetto al tuo solito, non rispetto agli altri.',
    sections: [
      {
        heading: 'La tua media',
        paragraphs: [
          'RingLife confronta ogni valore con i tuoi ultimi 28 giorni, oggi escluso. Prende il valore centrale (la mediana) e quanto i tuoi valori di solito si allontanano da lì.',
          'Lo scostamento di oggi si misura in quelle unità, da −3 a +3. Così 64 di Recupero può essere un giorno normale per te e un giorno basso per un altro.',
        ],
      },
      {
        heading: 'La livella',
        paragraphs: [
          "Il tubo va da −3 a +3 scostamenti. Tra le due tacche c'è il tuo solito. La bolla è il valore di oggi.",
          "La bolla è verde quando sei nel tuo solito o meglio, ambra quando sei peggio. Accanto c'è sempre scritto a parole: per il battito a riposo, per esempio, stare a sinistra vuol dire stare meglio.",
        ],
      },
      {
        heading: 'Calibrazione',
        paragraphs: [
          "Per una media servono almeno 7 giorni. Per le misure della notte il primo confronto arriva l'ottava notte, perché la notte di oggi non entra nella media. Fino ad allora Oggi scrive quante notti mancano e la livella resta vuota e tratteggiata.",
        ],
      },
      {
        heading: 'Le zone fisse',
        paragraphs: [
          'Nel dettaglio di ogni indice trovi anche due soglie uguali per tutti: 85 e 70. Da 85 in su la giornata è ottima, sotto 70 conviene andare piano. Sono soglie iniziali, non valori medici.',
        ],
      },
    ],
    related: ['recupero', 'indice-sonno', 'movimento', 'stress'],
  },
  recupero: {
    group: 'indici',
    title: 'Recupero',
    lead: 'Quanto il corpo si è ripreso dalla notte e dal giorno prima, da 0 a 100. Sta al centro del giro in Oggi.',
    sections: [
      {
        heading: 'Da cosa nasce',
        paragraphs: [
          'Cinque segnali con pesi fissi: variabilità del battito (HRV) di notte 35%, battito a riposo di notte 25%, temperatura della notte 15%, indice Sonno 15%, Stress di ieri 10%.',
          'HRV, battito a riposo e temperatura si confrontano con la tua media. Un valore uguale alla media vale 75 punti; ogni scostamento nella direzione buona ne aggiunge 12,5, in quella cattiva ne toglie 12,5. Sonno e Stress entrano con il loro punteggio.',
          'Se un segnale manca, il suo peso passa agli altri. Se mancano segnali per più di metà del peso, il Recupero non si calcola.',
        ],
      },
      {
        heading: 'Il verdetto',
        paragraphs: [
          'Da 85 in su: «Puoi spingere». Da 70 a 84: «Giornata nella norma». Sotto 70: «Vai piano oggi». Sono suggerimenti di benessere, non indicazioni mediche.',
          '«Cosa pesa sul numero» mostra i due segnali che ti hanno tolto più punti rispetto al tuo solito.',
        ],
      },
    ],
    related: ['hrv', 'battito-riposo', 'temperatura', 'affaticamento', 'come-leggere'],
  },
  'indice-sonno': {
    group: 'indici',
    title: 'Indice Sonno',
    lead: 'Come è andata la notte, da 0 a 100. Appartiene al giorno in cui ti svegli.',
    sections: [
      {
        heading: 'Da cosa nasce',
        paragraphs: [
          "Durata rispetto al tuo obiettivo 30%, efficienza 15%, quota di sonno profondo 15%, quota di REM 15%, risvegli e minuti svegli 10%, regolarità dell'orario 10%, battito minimo della notte rispetto alla tua media 5%.",
          "Durata: dormire quanto l'obiettivo vale 100, di più non dà punti in più. Efficienza: il 95% del tempo a letto passato dormendo vale 100, il 75% vale 0. Profondo: il 15% della notte vale 100. REM: il 20% vale 100. Ogni risveglio toglie 10 punti, ogni minuto sveglio mezzo punto.",
        ],
      },
      {
        heading: 'Da dove vengono i dati',
        paragraphs: [
          "Le fasi le calcola l'anello: RingLife le riceve già divise in leggero, profondo, REM e sveglio. L'obiettivo di sonno si cambia in Impostazioni › Obiettivi.",
        ],
      },
    ],
    related: ['fasi-sonno', 'regolarita', 'debito-sonno', 'come-leggere'],
  },
  movimento: {
    group: 'indici',
    title: 'Movimento',
    lead: 'Quanto e quanto spesso ti sei mosso in una giornata, da 0 a 100. Si calcola a giornata finita.',
    sections: [
      {
        heading: 'Da cosa nasce',
        paragraphs: [
          "Passi rispetto all'obiettivo 40%, ore attive 30%, minuti con il battito alto 20%, assenza di pause lunghe 10%.",
          "Un'ora è attiva con almeno 250 passi; 10 ore attive valgono 100. Trenta minuti con il battito in zona moderata o alta valgono 100. Ogni ora passata in pause di almeno 2 ore di fila, tra le 07:00 e le 23:00, toglie 12,5 punti.",
        ],
      },
      {
        heading: 'Durante il giorno',
        paragraphs: [
          "Finché la giornata non è finita, Oggi mostra i passi rispetto all'obiettivo. L'indice di ieri e il dettaglio ora per ora sono nella pagina Movimento.",
        ],
      },
    ],
    related: ['calorie', 'zone-battito', 'come-leggere'],
  },
  stress: {
    group: 'indici',
    title: 'Stress',
    lead: 'Quanto è stata tranquilla la giornata, da 0 a 100: più alto è meglio, come per gli altri indici. Si calcola a giornata finita.',
    sections: [
      {
        heading: "Lo stress dell'anello",
        paragraphs: [
          "Durante il giorno l'anello stima lo stress dal battito, su una scala da 0 a 100 dove più alto vuol dire più stress. È il numero che vedi in «Misura ora». L'indice Stress lo rovescia: più è alto, più la giornata è stata calma.",
        ],
      },
      {
        heading: 'Da cosa nasce',
        paragraphs: [
          'Carico, 70%: la quota di misure tra le 07:00 e le 23:00 con stress alto, cioè 60 o più. Con metà delle misure alte il carico vale 0.',
          'Recupero della sera, 30%: confronta lo stress tra le 19:00 e le 23:00 con quello del giorno. Se la sera scende di 20 punti vale 100, se sale di 20 vale 0.',
          'Servono almeno 8 misure di giorno. Il Recupero di oggi usa lo Stress di ieri.',
        ],
      },
    ],
    related: ['recupero', 'misura-ora', 'come-leggere'],
  },
  'debito-sonno': {
    group: 'indici',
    title: 'Debito di sonno',
    lead: 'Quante ore di sonno ti mancano rispetto al tuo obiettivo negli ultimi 7 giorni. Più è basso, meglio è.',
    sections: [
      {
        heading: 'Come si calcola',
        paragraphs: [
          "Per ogni notte conta solo quanto hai dormito meno dell'obiettivo. Le notti recenti pesano di più: l'ultima pesa 7 volte la più vecchia. In media ogni notte pesa 1, quindi un'ora in meno tutte le notti fa 7 ore di debito.",
          "Un'ora in più di sonno non cancella il debito di un'altra notte: il debito scende quando le notti corte escono dai 7 giorni.",
        ],
      },
    ],
    related: ['indice-sonno'],
  },
  affaticamento: {
    group: 'indici',
    title: 'Segnali di affaticamento',
    lead: 'Un avviso nel dettaglio del Recupero quando la notte mostra insieme più segnali di fatica.',
    sections: [
      {
        heading: 'I tre segnali',
        paragraphs: [
          'Battito a riposo almeno 1 scostamento sopra la tua media, variabilità del battito (HRV) almeno 1 sotto, temperatura almeno 1 sopra.',
          "Due segnali: «attenzione». Tre segnali: livello «alto», con il testo «Riposo consigliato oggi». Se nel Diario c'è alcol dalla sera prima, l'avviso lo cita come possibile causa e non supera «attenzione».",
        ],
      },
      {
        paragraphs: ['Non cambia il numero del Recupero e non è una diagnosi.'],
      },
    ],
    related: ['recupero', 'battito-riposo', 'hrv', 'temperatura'],
  },

  // ── Le misure dell'anello ─────────────────────────────────────────────────────────────────────────────────────
  stanotte: {
    group: 'misure',
    title: 'Stanotte',
    lead: 'Le misure del corpo mentre dormivi, in Sonno › «Il corpo, stanotte», ognuna confrontata con la tua media.',
    sections: [
      {
        paragraphs: [
          'Battito a riposo: quanto batte il cuore a riposo durante il sonno. Se è più basso del solito, in genere il corpo ha recuperato.',
          "Variabilità del battito (HRV): quanto cambia il tempo tra un battito e l'altro. Se è più alta del solito, in genere il corpo ha recuperato.",
          'Temperatura: lo scostamento della temperatura del dito dalla tua media. Conta solo la differenza.',
          "Ossigeno nel sangue (SpO2): la percentuale di ossigeno che il sangue trasporta. Conta l'andamento.",
          "Battito minimo: il valore più basso della notte. Pesa sull'indice Sonno; il battito a riposo pesa sul Recupero.",
        ],
      },
    ],
    related: ['battito-riposo', 'hrv', 'temperatura', 'ossigeno', 'come-leggere'],
  },
  'battito-riposo': {
    group: 'misure',
    title: 'Battito a riposo',
    lead: 'Quanti battiti al minuto (bpm) fa il cuore mentre dormi. Più è basso rispetto al tuo solito, più sei recuperato.',
    sections: [
      {
        paragraphs: [
          "Viene dalle misure che l'anello fa da solo durante la notte, ogni pochi minuti. L'intervallo si sceglie in Impostazioni › Anello.",
          "Un battito a riposo più alto del solito per qualche notte può venire da fatica, alcol, un pasto tardi, caldo o un malessere in arrivo. Una notte sola dice poco: conta l'andamento.",
        ],
      },
    ],
    related: ['recupero', 'hrv', 'eta-cardio'],
  },
  hrv: {
    group: 'misure',
    title: 'Variabilità del battito (HRV)',
    lead: 'Quanto varia il tempo tra un battito e il successivo, in millisecondi (ms). Di notte, più è alta, più il corpo è rilassato e recuperato.',
    sections: [
      {
        paragraphs: [
          'Il cuore non batte come un metronomo: lo spazio tra due battiti cambia di continuo. Quando il corpo è a riposo cambia di più, quando è sotto sforzo o stanco cambia di meno.',
          'I valori cambiano molto da persona a persona, quindi RingLife non ti confronta con gli altri: guarda solo lo scostamento dalla tua media. Pesa il 35% del Recupero.',
          "L'anello la misura soprattutto di notte, a intervalli di 30 minuti. In «Misura ora» puoi misurarla da sveglio, ma un valore di giorno non si confronta con quelli della notte.",
        ],
      },
    ],
    related: ['recupero', 'battito-riposo', 'misura-ora'],
  },
  temperatura: {
    group: 'misure',
    title: 'Temperatura',
    lead: "La temperatura della pelle del dito stimata dall'anello. Conta di quanto la notte si scosta dalla tua media, non il valore in gradi.",
    sections: [
      {
        paragraphs: [
          'La pelle del dito è più fredda del corpo e cambia con la stanza, le coperte e la posizione della mano. Per questo il valore in gradi non è quello di un termometro.',
          'Lo scostamento notturno invece è utile: un aumento di qualche decimo rispetto al tuo solito può accompagnare fatica o un malessere in arrivo. Pesa il 15% del Recupero.',
          "L'anello la misura da solo ogni 30 minuti mentre lo porti. Nella pagina Temperatura, «Misura ora» ne fa una adesso, in circa 30 secondi. Le misure delle ultime 48 ore restano sul telefono.",
        ],
      },
    ],
    related: ['recupero', 'affaticamento', 'misura-ora'],
  },
  ossigeno: {
    group: 'misure',
    title: 'Ossigeno nel sangue (SpO2)',
    lead: "La percentuale di ossigeno che il sangue trasporta (saturazione). Dal dito è una stima approssimata: conta l'andamento rispetto al tuo solito.",
    sections: [
      {
        paragraphs: [
          "L'anello la misura con la luce, attraverso la pelle. Movimento, freddo e anello largo la rendono meno precisa.",
          'RingLife non usa soglie uguali per tutti: guarda come cambia la tua mediana della notte nel tempo. Vedi «Respiro notturno».',
        ],
      },
    ],
    related: ['respiro-notturno', 'misura-ora'],
  },
  'battito-oggi': {
    group: 'misure',
    title: 'Battito di oggi',
    lead: "Le misure del battito che l'anello ha fatto oggi, con il tuo battito a riposo di notte come riferimento.",
    sections: [
      {
        paragraphs: [
          "L'anello misura il battito da solo, a intervalli che scegli in Impostazioni › Anello. Dove la linea si interrompe l'anello non ha misurato: era tolto, in carica, o la misura non è riuscita.",
          'La linea tratteggiata è il tuo battito a riposo della notte. Di giorno il battito sta sopra: in piedi, dopo un caffè o camminando sale.',
          'Tocca il grafico per leggere ora e battito. Le misure delle ultime 48 ore restano sul telefono.',
        ],
      },
    ],
    related: ['battito-riposo', 'misura-ora', 'zone-battito'],
  },
  'eta-cardio': {
    group: 'misure',
    title: 'Età cardio',
    lead: "L'età a cui una persona tipica ha il tuo stesso consumo massimo di ossigeno (VO2max). Più è bassa della tua età, più cuore e polmoni sono allenati.",
    sections: [
      {
        heading: 'Come si stima',
        paragraphs: [
          "Battito massimo stimato dall'età: 208 − 0,7 × età. Battito a riposo: la mediana delle ultime 14 notti, almeno 5.",
          'VO2max stimato: 15,3 × battito massimo ÷ battito a riposo, in millilitri di ossigeno per chilo al minuto. Poi RingLife cerca a che età quel valore è la mediana della popolazione, da un grande registro di prove da sforzo.',
        ],
      },
      {
        heading: 'Limiti',
        paragraphs: [
          "È una stima da formule, non una prova da sforzo. Il battito a riposo della notte è più basso di quello da sveglio, quindi la stima tende a essere ottimista. Serve l'anno di nascita in Impostazioni › Profilo; il sesso rende la stima più precisa.",
        ],
      },
    ],
    related: ['battito-riposo', 'zone-battito'],
  },
  'zone-battito': {
    group: 'misure',
    title: 'Zone del battito',
    lead: "Cinque fasce di intensità, in percentuale del tuo battito massimo stimato dall'età.",
    sections: [
      {
        paragraphs: [
          "Zona 1 dal 50% del battito massimo, zona 2 dal 60%, zona 3 dal 70%, zona 4 dall'80%, zona 5 dal 90%. Il battito massimo si stima con 208 − 0,7 × età.",
          "Le zone si vedono durante l'allenamento e nel suo riepilogo. Servono l'anno di nascita in Impostazioni › Profilo.",
          "L'indice Movimento sul server usa invece una soglia fissa in battiti al minuto, perché il server non conosce la tua età.",
        ],
      },
    ],
    related: ['allenamento', 'eta-cardio'],
  },
  calorie: {
    group: 'misure',
    title: 'Calorie giornaliere',
    lead: 'Una stima delle calorie che consumi in un giorno: a riposo, camminando e digerendo.',
    sections: [
      {
        paragraphs: [
          'A riposo: formula di Mifflin-St Jeor da età, altezza, peso e sesso (senza sesso, la media delle due formule). Camminando: passi × peso in chili × 0,0005. Digestione: il 10% della somma.',
          'Servono anno di nascita, altezza e peso in Impostazioni › Profilo. Il profilo resta sul telefono e non va al server.',
          "Le calorie di un allenamento sono un'altra stima, fatta dal battito: vedi «Allenamento».",
        ],
      },
    ],
    related: ['movimento', 'allenamento'],
  },

  // ── Il sonno ──────────────────────────────────────────────────────────────────────────────────────────────────
  'fasi-sonno': {
    group: 'sonno',
    title: 'Le fasi del sonno',
    lead: "La notte alterna sonno leggero, profondo e REM, con brevi risvegli. Le fasi le calcola l'anello.",
    sections: [
      {
        paragraphs: [
          'Leggero: la fase più lunga, un passaggio tra le altre.',
          'Profondo: la fase più riposante, in cui il corpo si ripara. Abbonda nella prima parte della notte.',
          'REM (Rapid Eye Movement, movimenti rapidi degli occhi): la fase in cui si sogna di più e la mente elabora la giornata. Abbonda verso il mattino.',
          'Sveglio: i minuti passati svegli a letto dopo esserti addormentato.',
        ],
      },
      {
        heading: 'Rispetto al tuo solito',
        paragraphs: [
          'Ogni fase si confronta con i tuoi minuti abituali. Più profondo e più REM sono meglio, più minuti svegli sono peggio; il leggero non è né meglio né peggio.',
          "L'anello stima le fasi da movimento e battito: è meno preciso di un esame del sonno in laboratorio.",
        ],
      },
    ],
    related: ['indice-sonno'],
  },
  regolarita: {
    group: 'sonno',
    title: 'Regolarità del sonno',
    lead: "Quanto resta costante l'orario del sonno da una notte all'altra, da 0 a 100.",
    sections: [
      {
        paragraphs: [
          "Si guarda il punto medio del sonno delle ultime 7 notti, almeno 5. Il 70% del punteggio dice quanto cambia da una notte all'altra: se varia di 90 minuti o più vale 0. Il 30% dice quanto il fine settimana si sposta dai giorni di lavoro: 2 ore o più valgono 0.",
          "Un orario stabile aiuta l'orologio interno. Pesa il 10% dell'indice Sonno.",
        ],
      },
    ],
    related: ['punto-medio', 'jet-lag-sociale', 'ritmo-circadiano'],
  },
  'punto-medio': {
    group: 'sonno',
    title: 'Punto medio del sonno',
    lead: "L'ora a metà tra quando ti addormenti e quando ti svegli. Dice a che ora del giorno cade il tuo sonno.",
    sections: [
      {
        paragraphs: [
          'Esempio: addormentato alle 23:30 e sveglio alle 07:30, il punto medio è alle 03:30.',
          'Il punto medio è più stabile degli orari di addormentamento e risveglio presi da soli, perché una sveglia anticipata o una sera lunga lo spostano di metà. Per questo lo usano Regolarità, Ritmo circadiano e Jet lag sociale.',
        ],
      },
    ],
    related: ['regolarita', 'ritmo-circadiano', 'jet-lag-sociale'],
  },
  'respiro-notturno': {
    group: 'sonno',
    title: 'Respiro notturno',
    lead: "L'ossigeno nel sangue (SpO2) durante il sonno: la mediana e il minimo della notte, confrontati con la tua media.",
    sections: [
      {
        paragraphs: [
          'Servono almeno 10 misure di ossigeno tra addormentamento e risveglio. La mediana della notte si confronta con le mediane delle tue 28 notti precedenti.',
          'Se la mediana resta almeno 2 scostamenti sotto la tua media per 3 notti di fila, la scheda scrive «da guardare». Se succede spesso, parlane con un medico. Non è una diagnosi: dal dito la misura è approssimata.',
        ],
      },
    ],
    related: ['ossigeno'],
  },

  // ── I plugin ──────────────────────────────────────────────────────────────────────────────────────────────────
  emicrania: {
    group: 'plugin',
    title: 'Emicrania',
    lead: 'Il diario delle cefalee e una stima del rischio di oggi, da sonno, battito, stress, diario e pressione atmosferica.',
    sections: [
      {
        heading: 'Il rischio di oggi',
        paragraphs: [
          'Somma i punti delle condizioni presenti: sonno corto 20, variabilità del battito (HRV) bassa 20, battito a riposo alto 10, debito di sonno 10, sonno irregolare 10, stress alto ieri 10, molta caffeina 10, alcol 10, calo di pressione 10, temperatura notturna fuori dalla tua media 5.',
          'Da 30 il rischio è medio, da 60 alto. Soglie e limiti si cambiano in Impostazioni › Plugin. Sono ipotesi iniziali, non evidenze: con il tempo vedrai se per te funzionano.',
          "La pressione arriva dal meteo di Home Assistant, se il server ce l'ha.",
        ],
      },
      {
        heading: 'Diario e report',
        paragraphs: [
          "Registra apre la cefalea con l'intensità; i dettagli si aggiungono dopo. Dalla pagina del plugin trovi il mese delle cefalee e il report per il medico in PDF, su 30, 90 o 180 giorni.",
          'Da 5 episodi il plugin cerca le ricorrenze. Da 20 episodi si potrà provare un modello personale.',
        ],
      },
    ],
    related: ['registra', 'hrv', 'debito-sonno', 'regolarita'],
  },
  'finestra-caffeina': {
    group: 'plugin',
    title: 'Finestra caffeina',
    lead: 'Da che ora iniziare e a che ora smettere con la caffeina, dal tuo risveglio e dal tuo obiettivo di sonno.',
    sections: [
      {
        paragraphs: [
          "Inizio: il risveglio più l'attesa scelta, di base 90 minuti. Fine: l'ora di coricarsi meno le ore di stop, di base 8. L'ora di coricarsi è il risveglio meno l'obiettivo di sonno.",
          'Esempio: sveglia alle 07:00 e 8 ore di sonno. Inizio alle 08:30, coricarsi alle 23:00, stop alle 15:00.',
          'La caffeina resta in circolo per ore: un caffè nel pomeriggio può accorciare il sonno anche se ti addormenti lo stesso. Risveglio e obiettivo seguono Impostazioni › Obiettivi; attesa e stop si cambiano in Impostazioni › Plugin.',
          "Nel giro delle 24 ore la finestra è l'arco della caffeina.",
        ],
      },
    ],
    related: ['giro', 'registra'],
  },
  'ritmo-circadiano': {
    group: 'plugin',
    title: 'Ritmo circadiano',
    lead: "Quanto il punto medio del tuo sonno è vicino all'obiettivo e quanto cambia da una notte all'altra.",
    sections: [
      {
        paragraphs: [
          "L'obiettivo è il punto medio tra l'ora di coricarsi e il risveglio che hai scelto. Il plugin lo confronta con la media delle ultime 7 notti, almeno 4.",
          "Se il sonno cade più di 30 minuti dopo l'obiettivo, suggerisce luce del mattino e un po' di movimento appena sveglio, che aiutano a spostarlo prima. Se il punto medio cambia di più di un'ora da una notte all'altra, suggerisce orari più fissi.",
        ],
      },
    ],
    related: ['punto-medio', 'regolarita', 'jet-lag-sociale'],
  },
  'jet-lag-sociale': {
    group: 'plugin',
    title: 'Jet lag sociale',
    lead: 'Quanto si sposta il tuo sonno nel fine settimana rispetto ai giorni di lavoro. Per il corpo uno spostamento grande è come cambiare fuso orario due volte a settimana.',
    sections: [
      {
        heading: 'Da dove viene il nome',
        paragraphs: [
          "Dopo un volo l'orologio interno resta sul fuso di partenza e ci mette giorni ad adattarsi: è il jet lag. Il jet lag sociale è lo stesso scarto senza viaggiare. Nei giorni di lavoro la sveglia ti fa alzare prima di quanto vorrebbe l'orologio interno; nel fine settimana dormi quando vuole lui.",
          'Il venerdì sera ti sposti più tardi, il lunedì mattina torni indietro di colpo. Il termine viene dagli studi sul cronotipo di Till Roenneberg e colleghi, pubblicati dal 2006.',
        ],
      },
      {
        heading: 'Come lo calcola RingLife',
        paragraphs: [
          "Per ogni notte prende il punto medio del sonno, l'ora a metà tra addormentamento e risveglio. Poi divide le ultime 4 settimane in due gruppi, secondo il giorno del risveglio: sabato e domenica sono i giorni liberi, da lunedì a venerdì i giorni di lavoro.",
          'Per ogni gruppo prende il valore centrale (la mediana), così una notte fuori dal comune non sposta il risultato. Il jet lag sociale è la differenza tra i due. Servono almeno 2 notti di fine settimana e 3 di giorni di lavoro.',
        ],
      },
      {
        heading: 'Un esempio',
        paragraphs: [
          'Nei giorni di lavoro dormi dalle 23:30 alle 07:00: punto medio alle 03:15. Nel fine settimana dormi dalle 01:00 alle 09:30: punto medio alle 05:15. Il jet lag sociale è di 2 ore più tardi: livello alto.',
        ],
      },
      {
        heading: 'Come si legge',
        paragraphs: [
          'Sotto 1 ora il livello è basso, da 1 a 2 ore medio, da 2 ore alto. «Più tardi» vuol dire che nel fine settimana dormi più tardi, il caso più comune. «Prima» vuol dire che nel fine settimana ti sposti in anticipo.',
          'Le soglie sono iniziali, non valori medici.',
        ],
      },
      {
        heading: 'Cosa puoi fare',
        paragraphs: [
          "Tieni il risveglio del fine settimana entro un'ora da quello dei giorni di lavoro, e prendi luce del mattino appena sveglio. Se il sabato fai tardi, anticipa almeno la domenica: il lunedì pesa meno.",
        ],
      },
      {
        heading: 'Limiti',
        paragraphs: [
          "Sabato e domenica contano sempre come giorni liberi. Se lavori nel fine settimana o fai turni, il risultato non descrive la tua settimana. Contano solo le notti con il sonno registrato dall'anello.",
        ],
      },
    ],
    related: ['punto-medio', 'regolarita', 'ritmo-circadiano'],
  },
  'vitamina-d': {
    group: 'plugin',
    title: 'Vitamina D',
    lead: "Quanti minuti al sole bastano oggi per la vitamina D, e dopo quanti si rischia la scottatura, dall'indice UV di casa e dal tuo fototipo.",
    sections: [
      {
        paragraphs: [
          "L'indice UV arriva dal meteo di Home Assistant, ogni ora. Il plugin usa il più alto tra il picco di ieri e quello di oggi finora, perché al mattino l'UV di oggi è ancora basso.",
          'Dal fototipo (da 1, pelle chiarissima, a 6, pelle molto scura) stima dopo quanti minuti arriva la scottatura. Per la vitamina D, con viso e braccia scoperti nelle ore centrali, basta circa un quarto di quel tempo.',
          'Sotto UV 3 la pelle produce poca vitamina D: il plugin lo dice invece di dare minuti. Sono regole pratiche iniziali: il fototipo si sceglie in Impostazioni › Plugin.',
        ],
      },
    ],
  },
  'report-settimanale': {
    group: 'plugin',
    title: 'Report settimanale',
    lead: 'Sonno, Movimento e Recupero degli ultimi 7 giorni a confronto con la settimana prima.',
    sections: [
      {
        paragraphs: [
          'Per ogni indice confronta la media degli ultimi 7 giorni con quella dei 7 prima. Servono almeno 3 giorni per settimana. Un cambio di almeno 8 punti viene segnalato.',
        ],
      },
    ],
    related: ['indice-sonno', 'movimento', 'recupero'],
  },
  allenamento: {
    group: 'plugin',
    title: 'Allenamento',
    lead: "Una sessione con il battito dal vivo dall'anello: zona d'intensità, zona obiettivo, pausa, recupero del battito e calorie stimate.",
    sections: [
      {
        heading: 'Prima di iniziare',
        paragraphs: [
          "Scegli l'attività (camminata, corsa, bici, palestra o altro) e, se vuoi, una zona obiettivo da 1 a 5. La volta dopo l'app ti propone le stesse scelte.",
        ],
      },
      {
        heading: 'Durante',
        paragraphs: [
          'Vedi il battito, la zona in cui sei e, con una zona obiettivo, se sei dentro, sopra o sotto. Fuori zona la scritta diventa ambra. Pausa ferma il tempo e non registra i battiti; Riprendi continua.',
        ],
      },
      {
        heading: 'Recupero del battito',
        paragraphs: [
          "Dopo Fine l'anello misura ancora per un minuto. RingLife confronta il battito degli ultimi 10 secondi di attività con quello dei secondi da 50 a 60 dopo la fine: quanti battiti è sceso in un minuto.",
          'Più scende, più in fretta il cuore torna a riposo. Confrontalo con le tue sessioni della stessa attività, non con gli altri. Con «Salta» la sessione finisce subito, senza recupero.',
        ],
      },
      {
        heading: 'Calorie',
        paragraphs: [
          'Una stima dal battito, da età, peso e sesso, con la formula di Keytel e colleghi (2005). Ogni battito vale fino al successivo, al massimo 5 secondi, quindi le pause non contano. È nata per lo sforzo moderato: sotto i 90 battiti al minuto è meno precisa. Servono anno di nascita e peso in Impostazioni › Profilo.',
        ],
      },
      {
        heading: 'Dove finiscono i dati',
        paragraphs: [
          "Le sessioni restano sul telefono, le ultime 50, nello Storico, con i minuti di allenamento delle ultime 8 settimane. Non vanno al server: un valore al secondo cambierebbe il battito a riposo e gli indici. Durante una sessione l'anello non si sincronizza.",
        ],
      },
    ],
    related: ['zone-battito', 'respirazione', 'misura-ora'],
  },
  respirazione: {
    group: 'plugin',
    title: 'Respirazione guidata',
    lead: "Respiri seguendo un cerchio che si allarga e si stringe, con il battito dal vivo dall'anello accanto.",
    sections: [
      {
        paragraphs: [
          "Segui il cerchio: 4 secondi dentro, 6 fuori. Un'espirazione più lunga dell'inspirazione di solito fa scendere il battito. Alla fine vedi il battito dell'inizio e della fine.",
          'Con «riduci movimento» il cerchio resta fermo: restano la parola Inspira o Espira e il conto alla rovescia. Le sessioni restano sul telefono, nello Storico.',
        ],
      },
    ],
    related: ['allenamento'],
  },

  // ── Usare l'app ───────────────────────────────────────────────────────────────────────────────────────────────
  giro: {
    group: 'app',
    title: 'Il giro delle 24 ore',
    lead: 'Il cerchio in cima a Oggi: una giornata intera, con il Recupero al centro.',
    sections: [
      {
        paragraphs: [
          "Il cerchio è un orologio di 24 ore che gira in senso orario: mezzanotte in alto, mezzogiorno in basso. L'arco del sonno è la notte appena passata. La fascia «il tuo solito» è l'orario in cui dormi di solito.",
          "Se il plugin Finestra caffeina è acceso, un arco segna le ore della caffeina. Il punto «adesso» si muove con l'orologio del telefono.",
          'Tocca il giro per aprire il dettaglio del Recupero.',
        ],
      },
    ],
    related: ['recupero', 'finestra-caffeina'],
  },
  corpo: {
    group: 'app',
    title: 'La scheda Corpo',
    lead: "Quello che l'anello misura adesso e quello che fai con l'anello: battito di oggi, temperatura, Misura ora, allenamento e respirazione.",
    sections: [
      {
        paragraphs: [
          'Oggi risponde a come stai e cosa fare oggi. Corpo raccoglie le misure della giornata e gli strumenti: il grafico del battito, la temperatura, le misure a comando e le sessioni.',
          'Allenamento e respirazione compaiono con il plugin acceso, in Impostazioni › Plugin. I minuti di allenamento delle ultime 8 settimane sono sotto le due sessioni.',
        ],
      },
    ],
    related: ['battito-oggi', 'misura-ora', 'allenamento'],
  },
  'misura-ora': {
    group: 'app',
    title: 'Misura ora',
    lead: "Fa misurare all'anello adesso battito, ossigeno, variabilità del battito (HRV), stress o temperatura, uno alla volta.",
    sections: [
      {
        paragraphs: [
          "Ogni misura dura circa 30 secondi, l'HRV circa un minuto. Tieni la mano ferma e il telefono vicino. RingLife raccoglie fino a 6 valori, 9 per lo stress, e tiene quello di mezzo.",
          "Le misure a comando restano sul telefono e non entrano negli indici: gli indici usano le misure che l'anello fa da solo, di giorno e di notte.",
        ],
      },
    ],
    related: ['battito-oggi', 'temperatura', 'hrv', 'stress'],
  },
  sincronizzazione: {
    group: 'app',
    title: "Come l'app legge l'anello",
    lead: "L'anello conserva le misure per alcuni giorni. RingLife le legge via Bluetooth, le salva sul telefono e le manda al server di casa.",
    sections: [
      {
        heading: 'Quando legge',
        paragraphs: [
          "All'apertura dell'app, e quando torni nell'app dopo almeno 15 minuti dall'ultima lettura. Tirando giù Oggi legge subito. In background iOS sveglia l'app ogni tanto, non prima dell'intervallo scelto in Impostazioni › Anello: decide iOS quando.",
          "Dopo una lettura in background l'app prova anche a inviare i dati al server e a controllare gli avvisi, senza aprirla. Se iOS non le lascia il tempo, i dati restano sul telefono fino all'apertura.",
          "Con la lettura in background accesa, l'app chiede a iOS anche una lettura dopo il risveglio abituale: iOS la concede quando il telefono è inattivo, spesso in carica. Per avere più letture puoi aggiungere le automazioni di Comandi.",
        ],
      },
      {
        heading: 'Se qualcosa non va',
        paragraphs: [
          "L'anello parla con un'app alla volta: se un'altra app è collegata, RingLife non lo vede. Se il server di casa è spento, i dati restano in coda sul telefono e partono alla lettura dopo.",
          "A ogni lettura RingLife imposta l'ora dell'anello, che non conosce il fuso orario.",
        ],
      },
      {
        heading: 'Fuori casa',
        paragraphs: [
          "Se il server di casa non risponde, l'app mostra gli ultimi dati scaricati, e sotto la data di Oggi dice di quando sono. Gli indici restano quelli dell'ultimo calcolo: li calcola solo il server.",
          "Intanto l'anello si legge lo stesso: i passi di oggi e la notte appena passata si vedono subito, presi dall'anello. Tornato a casa, l'app invia quello che ha letto e scarica gli indici nuovi.",
        ],
      },
      {
        heading: 'Salta',
        paragraphs: [
          "All'apertura, «Salta» annulla la lettura: l'app non cerca più l'anello e non prova il server. Per leggere più tardi tira giù Oggi, o torna nell'app dopo un quarto d'ora.",
        ],
      },
    ],
  },
  avvisi: {
    group: 'app',
    title: 'Avvisi',
    lead: "RingLife ti avvisa quando un valore è lontano dal tuo solito, o quando qualcosa non va con l'anello o il server di casa.",
    sections: [
      {
        heading: 'Quali',
        paragraphs: [
          'Accesi di predefinito: segnali di affaticamento, temperatura della notte, battito a riposo, variabilità del battito (HRV), respiro notturno, Recupero basso per 3 giorni e, con il plugin acceso, rischio emicrania alto. Spenti: debito di sonno e passi bassi.',
          "Gli avvisi sulla tua media confrontano i valori con i tuoi ultimi 28 giorni, con la stessa scala della livella: «Normale» vuol dire almeno 2 scostamenti in una notte, o 1 per più notti di fila. Partono dall'ottava notte, quando la tua media è pronta.",
        ],
      },
      {
        heading: 'Come arrivano',
        paragraphs: [
          "Li calcola il server di casa quando riceve i dati dell'anello. L'app li scarica alla lettura dopo e manda una notifica; più avvisi insieme diventano una notifica sola. Nelle ore silenziose la notifica aspetta.",
          "Sulla schermata bloccata il testo dice il problema in breve, o solo «un nuovo avviso» se scegli il testo generico. Ogni avviso resta nell'elenco Avvisi, dalla campanella in Oggi, anche se la notifica si perde.",
          'Dal telefono arrivano anche «anello non letto da 24 ore», i dati non inviati da 3 giorni e il server non raggiungibile da 2.',
          "Gli avvisi della notte partono quando la notte è finita: il server aspetta dati dell'anello di almeno 30 minuti dopo il risveglio. Una lettura fatta appena sveglio non basta; quella dopo sì.",
        ],
      },
      {
        heading: 'Notifiche dal server di casa',
        paragraphs: [
          "Con le notifiche dal server accese, l'avviso arriva appena il server lo calcola, anche con l'app chiusa. Passa dal servizio di notifiche di Apple, ma cifrato: Apple vede solo «Avviso di RingLife», il testo vero lo legge solo il telefono.",
          "Servono una chiave di Apple sul server di casa e una configurazione dell'app fatta una volta. Finché mancano, gli avvisi arrivano come prima, quando l'app legge l'anello.",
        ],
      },
      {
        heading: 'I tuoi avvisi',
        paragraphs: [
          "In Impostazioni › Notifiche puoi costruire avvisi tuoi, fino a 20: una misura, sopra o sotto la tua media o un valore, per quanti giorni di fila. Per esempio «Passi sotto 3.000 per 3 giorni di fila».",
          "Temperatura e ossigeno si confrontano solo con la tua media: il valore del dito non è un termometro, e sull'ossigeno RingLife non usa soglie mediche.",
        ],
      },
      {
        heading: 'Cosa non sono',
        paragraphs: [
          'Non sono diagnosi: dicono che un valore è lontano dal tuo solito. Senza server non partono avvisi sui valori; al ritorno arriva una notifica sola con quelli dei giorni mancanti.',
        ],
      },
    ],
    related: ['come-leggere', 'sincronizzazione', 'automazioni'],
  },
  automazioni: {
    group: 'app',
    title: 'Automazioni di Comandi',
    lead: "Con un'automazione di Comandi l'iPhone legge l'anello a un orario, anche con l'app chiusa. Così i dati arrivano al server, e gli avvisi a te, senza aprire RingLife.",
    sections: [
      {
        heading: 'Quali creare',
        paragraphs: [
          "Dopo il risveglio: «Ora del giorno», tre quarti d'ora dopo la sveglia. A quell'ora la notte è finita da abbastanza perché il server possa dare gli avvisi del mattino.",
          'A metà giornata e la sera: altre due «Ora del giorno», per esempio alle 13 e alle 21.',
          'Se l\'iPhone sta in carica di notte, puoi usare anche «Caricatore scollegato». «Sveglia fermata» legge troppo presto: gli avvisi della notte aspetterebbero la lettura dopo.',
        ],
      },
      {
        heading: 'Come',
        paragraphs: [
          "In Comandi: Automazione, «+», scegli il tipo («Ora del giorno»), poi «Esegui immediatamente» e spegni «Notifica quando viene eseguita». Come azione aggiungi «Leggi l'anello» di RingLife.",
          "L'app non può creare le automazioni da sola: le crei tu una volta, e restano.",
        ],
      },
      {
        heading: 'Se non funziona',
        paragraphs: [
          "Impostazioni › Anello mostra le ultime letture in background, con chi le ha chieste, com'è andata e se i dati sono arrivati al server. Con l'app aperta l'automazione non legge: legge già l'app.",
        ],
      },
    ],
    related: ['sincronizzazione', 'avvisi'],
  },
  registra: {
    group: 'app',
    title: 'Registra e il diario',
    lead: "Il pulsante Registra segna una cefalea, la caffeina, l'alcol o una nota. Tutto finisce nel Diario.",
    sections: [
      {
        paragraphs: [
          "Registra si apre sull'intensità della cefalea: due tocchi e l'episodio è aperto. Finché è aperto, Oggi diventa «Episodio in corso», con colori più tenui.",
          'Caffeina e alcol servono ai plugin Emicrania e Finestra caffeina. La caffeina di tutti i giorni si segna da sola: si imposta in Impostazioni › Abitudini e nel Diario si toglie il giorno che salti.',
        ],
      },
    ],
    related: ['emicrania', 'finestra-caffeina'],
  },
} as const satisfies Record<string, GuideTopic>;

export type GuideTopicId = keyof typeof GUIDE;

/** La pagina della Guida di un plugin, per id del plugin (`settings.model.ts`, `PLUGIN_IDS`, e i plugin del server). */
export const PLUGIN_GUIDE: Readonly<Record<string, GuideTopicId>> = {
  migraine: 'emicrania',
  'caffeine-window': 'finestra-caffeina',
  circadian: 'ritmo-circadiano',
  'social-jetlag': 'jet-lag-sociale',
  'vitamin-d': 'vitamina-d',
  'weekly-report': 'report-settimanale',
  training: 'allenamento',
};

export function guideTopic(id: string): (GuideTopic & { id: GuideTopicId }) | null {
  return Object.hasOwn(GUIDE, id)
    ? { id: id as GuideTopicId, ...(GUIDE as Record<string, GuideTopic>)[id] }
    : null;
}

/** Le pagine di un gruppo, nell'ordine in cui sono scritte. */
export function guideGroup(group: GuideGroupId): (GuideTopic & { id: GuideTopicId })[] {
  return (Object.keys(GUIDE) as GuideTopicId[])
    .map((id) => ({ id, ...(GUIDE as Record<string, GuideTopic>)[id] }))
    .filter((topic) => topic.group === group);
}
