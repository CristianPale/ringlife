#!/usr/bin/env python3
"""Prova rapida di un backend RingLife in funzione (per esempio l'app sul server di casa), solo con dati sintetici.

Controlla salute, registrazione, autenticazione, caricamento idempotente di una notte e lettura del risultato.
Uso: python3 scripts/smoke_test_server.py http://<indirizzo>:8080 <segreto-di-registrazione>

Lascia nel database un dispositivo `smoke-test-...` con una notte inventata. Le baseline dei dispositivi veri non
cambiano, ma le entita' di Home Assistant mostrano questi dati finche' il telefono non fa il primo sync vero.
"""
import json
import sys
import time
import urllib.error
import urllib.request
import uuid

MIN = 60_000


def call(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            text = response.read().decode()
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        return error.code, None


def main(base, secret):
    base = base.rstrip("/")
    failures = []

    def check(name, ok, detail=""):
        print(("  ok  " if ok else "  KO  ") + name + (f" ({detail})" if detail and not ok else ""))
        if not ok:
            failures.append(name)

    print(f"Server: {base}")
    status, body = call("GET", f"{base}/actuator/health")
    check("risponde e sta bene", status == 200 and body and body.get("status") == "UP", f"stato {status}")
    if status != 200:
        return 1

    hardware = f"smoke-test-{uuid.uuid4().hex[:12]}"
    status, _ = call("POST", f"{base}/api/v1/devices", {"hardwareId": hardware, "model": "synthetic"}, {"X-Pairing-Secret": "sbagliato"})
    check("rifiuta un segreto di registrazione sbagliato", status == 401, f"stato {status}")
    status, registration = call("POST", f"{base}/api/v1/devices", {"hardwareId": hardware, "model": "synthetic"}, {"X-Pairing-Secret": secret})
    check("registra un dispositivo con il segreto giusto", status == 200 and registration and "token" in registration, f"stato {status}")
    if not registration:
        return 1
    device, token = registration["deviceId"], {"Authorization": f"Bearer {registration['token']}"}

    status, _ = call("GET", f"{base}/api/v1/devices/{device}/days/2026-01-01")
    check("rifiuta una richiesta senza token", status == 401, f"stato {status}")

    # Una notte finita da poco: a letto 8 ore fa, in piedi mezz'ora fa.
    end = int(time.time() * 1000) - 30 * MIN
    start = end - 450 * MIN
    cursor, stages = start, []
    for stage, minutes in (("awake", 10), ("light", 120), ("deep", 70), ("light", 60), ("rem", 50), ("light", 140)):
        stages.append({"stage": stage, "start": cursor, "end": cursor + minutes * MIN})
        cursor += minutes * MIN
    sleep = {"tzOffsetMin": 60, "sessions": [{"start": start, "end": cursor, "stages": stages}]}
    samples = {"tzOffsetMin": 60, "samples": [{"metric": "HR", "ts": start + i * 5 * MIN, "value": 55 + i % 4} for i in range(60)]}

    status, first = call("POST", f"{base}/api/v1/devices/{device}/sleep", sleep, token)
    check("carica una notte", status == 200 and first and first["inserted"] == 1, f"stato {status}")
    status, again = call("POST", f"{base}/api/v1/devices/{device}/sleep", sleep, token)
    check("ricaricare la stessa notte non duplica niente", status == 200 and again and again["inserted"] == 0 and again["duplicates"] == 1, f"stato {status}")
    status, result = call("POST", f"{base}/api/v1/devices/{device}/samples", samples, token)
    check("carica i campioni", status == 200 and result and result["inserted"] == 60, f"stato {status}")

    today = time.strftime("%Y-%m-%d", time.localtime())
    status, days = call("GET", f"{base}/api/v1/devices/{device}/days?from={today}&to={today}", headers=token)
    day = days[0] if status == 200 and days else {}
    check("calcola l'indice Sonno", "sleep" in day.get("scores", {}), f"stato {status}")
    check("restituisce la notte con le fasi", bool(day.get("sleep")) and len(day["sleep"]["stages"]) == 6)

    print("\nTutto a posto." if not failures else f"\nDa guardare: {', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
