# Strumenti dello spike (fase 0)

Servono il giorno in cui arriva l'anello. Python, solo qui: né il backend né l'app li usano. Guida passo passo: `docs/release/ANELLO-GIORNO-1.md`.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r tools/requirements.txt
python3 -m unittest tools/test_tools.py      # prove che non richiedono Bluetooth
```

| Strumento | A cosa serve |
|---|---|
| `ringtool.py` | Cerca l'anello (`scan`), ne elenca i servizi (`services`), manda comandi e salva i pacchetti (`capture`), resta collegato e registra quello che l'anello manda da solo con la batteria (`watch`, riassunto con `watch-summary`; `docs/release/PROVA-COLLEGAMENTO-CONTINUO.md`). La parte Bluetooth non è provata senza anello. |
| `btsnoop_to_capture.py` | Trasforma il registro HCI di Android (con l'app del produttore che parla con l'anello) in una cattura. Non provato su registri veri. |
| `checksum_check.py` | Dice quale checksum, `mod255` o `mod256`, torna sui pacchetti catturati. |
| `capture_format.py` | Il formato delle catture: lettura, scrittura, controlli. |

Le catture e i registri stanno **solo** in `local-data/` (ignorata da git, fuori dalla CI). Il formato rifiuta indirizzi MAC. Un pacchetto va nel repo solo come fixture anonimizzata (`CLAUDE.md`, sezione Repository e privacy).

`colmi_r02_client` si può installare a parte per confrontare un comando, ma la sua licenza è da verificare: non se ne copia codice.
