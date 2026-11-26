#!/bin/sh
# Prepara la cartella dell'app locale di Home Assistant: file dell'app piu' il jar del backend.
# Uso: sh scripts/package-ha-app.sh [cartella-di-uscita]   (predefinita: build/ha-app/ringlife)
# Variabili: MVN_ARGS, per esempio "-s /percorso/settings.xml -Djava.version=21" su un JDK piu' vecchio.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/build/ha-app/ringlife}"

# shellcheck disable=SC2086
(cd "$root/backend" && mvn -q -DskipTests ${MVN_ARGS:-} package)

jar="$(ls "$root"/backend/target/ringlife-backend-*.jar 2>/dev/null | head -n 1)"
if [ -z "$jar" ]; then
    echo "Jar del backend non trovato in backend/target." >&2
    exit 1
fi

rm -rf "$out"
mkdir -p "$out"
# Il container gira su Linux: i file che interpreta (shebang di run.sh, Dockerfile, config.yaml) devono avere
# fine riga LF. Su un checkout Windows possono essere CRLF: si convertono le copie, non i sorgenti.
for file in config.yaml Dockerfile run.sh; do
    tr -d '\r' < "$root/ha-app/ringlife/$file" > "$out/$file"
done
# L'app locale si costruisce sul server dal Dockerfile: senza `image` Home Assistant non cerca un'immagine
# pubblicata (docs/adr/0038). La riga resta solo nel repository pubblico.
grep -v '^image:' "$out/config.yaml" > "$out/config.yaml.tmp"
mv "$out/config.yaml.tmp" "$out/config.yaml"
cp "$root/ha-app/ringlife/DOCS.md" "$out/DOCS.md"
# Le novita' di ogni versione: Home Assistant le mostra quando c'e' un aggiornamento (docs/adr/0037).
cp "$root/CHANGELOG.md" "$out/CHANGELOG.md"
# Icona e logo dell'app nell'elenco delle app di Home Assistant.
cp "$root/ha-app/ringlife/icon.png" "$root/ha-app/ringlife/logo.png" "$out/"
chmod a+x "$out/run.sh"
cp "$jar" "$out/ringlife-backend.jar"

# Licenze di terze parti (docs/adr/0038): i componenti dell'immagine e le dipendenze del jar, dall'elenco che
# license-maven-plugin scrive a ogni build del backend.
third_party="$root/backend/target/generated-sources/license/THIRD-PARTY.txt"
if [ ! -f "$third_party" ]; then
    echo "Elenco delle licenze non trovato: $third_party" >&2
    exit 1
fi
{
    echo "RingLife server: third-party software"
    echo
    echo "The container image of the Home Assistant app contains:"
    echo "  - the Home Assistant base image (ghcr.io/home-assistant/*-base-debian), with Debian packages under"
    echo "    their own licenses (see /usr/share/doc/*/copyright in the image) and bashio (Apache-2.0);"
    echo "  - Eclipse Temurin JRE (GPL-2.0 with Classpath Exception), https://adoptium.net, source at"
    echo "    https://github.com/adoptium."
    echo
    echo "The server jar (ringlife-backend.jar) contains the dependencies below, with their licenses."
    echo "Where a dependency offers more than one license, RingLife uses it under the first one listed."
    cat "$third_party"
} > "$out/THIRD-PARTY-LICENSES.txt"

echo "App pronta in $out"
echo "Copiala in /local_apps/ringlife sul server (/addons/ringlife su HA meno recente) (Samba o SSH) e ricarica le app in Home Assistant."
