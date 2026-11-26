#!/bin/sh
# Gira SUL SERVER HA (app SSH), non su GitHub: scarica l'ultima release dell'app RingLife, la copia in
# <cartella delle app locali>/ringlife e fa aggiornare l'app al Supervisor. Nessuna porta aperta: e' il server che chiede a GitHub.
# Uso: sh update-ha-app.sh [--force]    (--force reinstalla anche se la release e' gia' quella installata)
#
# Variabili (tutte facoltative):
#   RINGLIFE_TOKEN_FILE  file col token GitHub di SOLA LETTURA (predefinito /share/ringlife/update.token). Serve solo
#                        per un repository privato: senza il file lo script chiede le release senza autenticazione.
#                        /share lo legge anche HA Core: il token deve essere fine-grained, su un solo repo, con scadenza breve.
#   RINGLIFE_REPO        proprietario/repo (predefinito CristianPale/ringlife)
#   RINGLIFE_APP_DIR     cartella dell'app locale (predefinita /local_apps/ringlife se esiste /local_apps, altrimenti /addons/ringlife)
#   RINGLIFE_APP_SLUG    slug dell'app nel Supervisor (predefinito local_ringlife)
#   RINGLIFE_API         base dell'API GitHub (predefinita https://api.github.com; serve ai test)
# Il token non finisce mai nei log ne' nella lista dei processi.
set -eu

repo="${RINGLIFE_REPO:-CristianPale/ringlife}"
token_file="${RINGLIFE_TOKEN_FILE:-/share/ringlife/update.token}"
# HA recente chiama la cartella delle app locali /local_apps, le versioni precedenti /addons.
if [ -d /local_apps ]; then default_dir=/local_apps/ringlife; else default_dir=/addons/ringlife; fi
app_dir="${RINGLIFE_APP_DIR:-$default_dir}"
slug="${RINGLIFE_APP_SLUG:-local_ringlife}"
api="${RINGLIFE_API:-https://api.github.com}"
asset="ringlife-ha-app.tar.gz"
force=0
[ "${1:-}" = "--force" ] && force=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
umask 077
# Il token va in un file di intestazioni: curl lo legge da li', cosi' non compare tra gli argomenti. Senza token (repository
# pubblico) il file resta con un'intestazione innocua.
if [ -r "$token_file" ]; then
    printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n ' < "$token_file")" > "$tmp/auth"
else
    echo "Nessun token in $token_file: chiedo le release senza autenticazione (va bene per un repository pubblico)."
    printf 'X-RingLife-Update: 1\n' > "$tmp/auth"
fi

fetch() { # fetch <url> <uscita> [accept]
    curl -fsSL -H "@$tmp/auth" -H "Accept: ${3:-application/vnd.github+json}" -o "$2" "$1"
}

if ! fetch "$api/repos/$repo/releases/latest" "$tmp/release.json"; then
    echo "Nessuna release trovata in $repo (repository privato senza token, token senza accesso o scaduto, o nessuna release pubblicata)." >&2
    exit 1
fi
flat="$(tr -d '\n ' < "$tmp/release.json")"
tag="$(printf '%s' "$flat" | grep -o '"tag_name":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
if [ -z "$tag" ]; then
    echo "Nessuna release trovata (repository privato senza token o con un token senza accesso, o nessuna release pubblicata)." >&2
    exit 1
fi

if [ "$force" = 0 ] && [ -r "$app_dir/.release-tag" ] && [ "$(cat "$app_dir/.release-tag")" = "$tag" ]; then
    echo "Gia' aggiornato: $tag."
    exit 0
fi

asset_id() { # asset_id <nome>
    printf '%s' "$flat" \
        | grep -o "releases/assets/[0-9]*\",\"id\":[0-9]*,\"node_id\":\"[^\"]*\",\"name\":\"$1\"" \
        | head -n 1 | sed 's#releases/assets/\([0-9]*\)".*#\1#'
}
id_pack="$(asset_id "$asset")"
id_sum="$(asset_id "$asset.sha256")"
if [ -z "$id_pack" ] || [ -z "$id_sum" ]; then
    echo "La release $tag non contiene $asset e il suo .sha256." >&2
    exit 1
fi

echo "Scarico $tag..."
fetch "$api/repos/$repo/releases/assets/$id_pack" "$tmp/$asset" application/octet-stream
fetch "$api/repos/$repo/releases/assets/$id_sum" "$tmp/$asset.sha256" application/octet-stream
(cd "$tmp" && sha256sum -c "$asset.sha256" >/dev/null) || { echo "Controllo sha256 fallito: non installo." >&2; exit 1; }

mkdir "$tmp/app"
tar -xzf "$tmp/$asset" -C "$tmp/app"
for file in config.yaml Dockerfile run.sh ringlife-backend.jar icon.png logo.png; do
    [ -s "$tmp/app/$file" ] || { echo "Pacchetto incompleto: manca $file." >&2; exit 1; }
done

mkdir -p "$app_dir"
rm -rf "${app_dir:?}"/* "$app_dir"/.release-tag
cp -R "$tmp/app"/. "$app_dir"/
echo "Copiata in $app_dir."

# Il Supervisor rilegge le app locali; la versione nuova compare come aggiornamento. Il comando si chiama
# `ha apps` dalle versioni recenti di HA, `ha addons` prima: si prova il primo.
# La release si segna come installata solo quando il Supervisor l'ha presa: se l'aggiornamento si ferma, rilanciare lo
# script senza --force lo riprova invece di rispondere «Gia' aggiornato».
mark_installed() {
    printf '%s' "$tag" > "$app_dir/.release-tag"
}
if ! command -v ha >/dev/null 2>&1; then
    mark_installed
    echo "Comando 'ha' non disponibile qui: ricarica e aggiorna l'app dall'interfaccia di Home Assistant." >&2
    exit 0
fi
if ha apps --help >/dev/null 2>&1; then group=apps; else group=addons; fi
# `ha store reload` fa rileggere al Supervisor anche le app locali: provato su un Supervisor vero (23 novembre 2026),
# mentre `ha apps reload` non gli faceva vedere la versione nuova. Il secondo resta per le versioni che non hanno `store`.
ha store reload >/dev/null 2>&1 || ha "$group" reload >/dev/null
# Il Supervisor rilegge le app locali con un po' di ritardo: si aspetta che veda la versione nuova prima di
# chiedere l'aggiornamento (senza, `update` risponde "No update available").
new_version="$(grep '^version:' "$app_dir/config.yaml" | head -n 1 | cut -d: -f2 | tr -d ' "\r')"
if [ -n "$new_version" ]; then
    echo "Aspetto che il Supervisor veda la versione $new_version..."
    waited=0
    while [ "$waited" -lt "${RINGLIFE_WAIT_SECONDS:-90}" ]; do
        seen="$(ha "$group" info "$slug" 2>/dev/null | grep '^version_latest:' | head -n 1 | cut -d: -f2 | tr -d ' "\r')"
        [ "$seen" = "$new_version" ] && break
        sleep "${RINGLIFE_POLL_SECONDS:-3}"
        waited=$((waited + ${RINGLIFE_POLL_SECONDS:-3}))
    done
    if [ "$seen" != "$new_version" ]; then
        echo "Il Supervisor non vede ancora la versione $new_version: rilancia lo script tra poco, o riavvia il Supervisor." >&2
        exit 1
    fi
fi
ha "$group" update "$slug" || ha "$group" rebuild "$slug"
mark_installed
echo "Fatto: $tag."
