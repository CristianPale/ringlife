# Home Assistant app

The RingLife server runs as a Home Assistant app. Since Home Assistant 2026.2, add-ons are called "apps". Files, folders and commands may still use the old name `addon`.

This guide covers installation, options, network, data, entities and updates. The app files are in `ha-app/ringlife/`. The HTTP API is in [api.md](api.md).

RingLife is not a medical device. Its scores, estimates and risk levels are not diagnoses.

## What the app does

- Receives data from the RingLife phone app: ring samples, sleep sessions and the diary.
- Computes daily features, personal baselines, scores (Sleep, Recovery, Movement, Stress, Sleep regularity) and metrics such as sleep debt. Formulas are in [scores.md](scores.md).
- Runs the server plugins (see [plugins.md](plugins.md)) and builds the headache report PDF on request.
- Recomputes after every upload, and every night at 04:15 local time.
- Publishes the results to Home Assistant as MQTT sensors, through MQTT discovery.
- Reads the weather entity of Home Assistant every hour through the Supervisor, when you set `weather_entity`. The migraine plugin uses the air pressure, the vitamin D plugin the UV index.
- Serves the phone API on port 8080.

There is no web dashboard yet: `config.yaml` has no `ingress`.

The backend is a portable container configured with environment variables. The Home Assistant app is only a wrapper (`config.yaml`, `Dockerfile`, `run.sh`).

## Requirements

- **Home Assistant OS on an amd64 machine.** The app declares `arch: amd64` only. The server is usually shared with home automation, so the backend limits itself: the Java heap is at most 512 MB (`-Xmx512m`), and the process exits on out-of-memory so that the watchdog restarts it.
- **Mosquitto app (MQTT broker).** Install and start it first. RingLife declares `services: mqtt:need`. The broker host and credentials come from the Supervisor, so RingLife has no MQTT options.
- **Tailscale** on Home Assistant and on the phone, for HTTPS from outside home. See [Network and TLS](#network-and-tls).
- **To build the app yourself** (local app only): a computer with JDK 25 and Maven. An older JDK works with `MVN_ARGS="-Djava.version=21"`: the image runs Java 25, which also runs that jar. The Home Assistant machine never compiles Java.
- **Internet on install and on each update.** From the app repository, the Supervisor downloads the image `ghcr.io/<owner>/ringlife:<version>`. As a local app, it builds the image and downloads `ghcr.io/home-assistant/amd64-base-debian` and `eclipse-temurin:25-jre`. Once installed, the app calls no internet service except Apple's push service, and only when you set the `apns_*` options.

## Install from the app repository

This is the simplest way. Home Assistant downloads an image already built by this repository's GitHub Actions workflow (`.github/workflows/ha-image.yml`), so the server compiles nothing.

1. In Home Assistant, open Settings › Apps › App store, then the top-right menu › Repositories.
2. Add the URL of this repository, for example `https://github.com/<owner>/<repository>`, and close the dialog.
3. RingLife appears in the store. Open it and install it.
4. Continue with step 5 of the next section: set the pairing secret, start the app and check it.

The Supervisor pulls `<image>:<version>`, with `image` and `version` from `ha-app/ringlife/config.yaml`. Updates appear in Home Assistant when a new version is released. Right after a release the image may still be building for a few minutes: if an update fails to download, try again later.

Only the image and the list of versions come from GitHub. Your data, the database and the computations stay in `/data` on your server, and the app never sends anything to GitHub. If GitHub were unavailable, the installed app would keep working; you would only need another source to update or reinstall it.

In a fork, change `image` in `config.yaml` to `ghcr.io/<your user>/ringlife`, push a version tag so the workflow builds the image, then make the `ringlife` package public once: GitHub › your profile › Packages › ringlife › Package settings › Change visibility. The workflow stops with an error if `image` does not match the repository owner.

## Install as a local app

The steps below install the app from your own build; the Supervisor builds the image on the server. To install from a release package, see [Updating](#updating). The package script removes the `image` line from `config.yaml`, so Home Assistant builds from the `Dockerfile` instead of downloading an image.

1. **Build.** On your computer, from the repository root:

   ```bash
   sh scripts/package-ha-app.sh
   ```

   The script builds the backend jar and prepares `build/ha-app/ringlife` with `config.yaml`, `Dockerfile`, `run.sh`, `DOCS.md`, `CHANGELOG.md`, `icon.png`, `logo.png` and `ringlife-backend.jar`. It converts line endings to LF for the files the container reads. Pass Maven options in `MVN_ARGS`. An optional argument sets another output folder.

2. **Copy.** Copy the whole folder to `/local_apps/ringlife` on the server, with the Samba or SSH app. Older Home Assistant versions use `/addons/ringlife`.

3. **Reload.** Make the Supervisor read the local apps again. In the SSH app terminal:

   ```bash
   ha store reload
   ```

   Or, in Home Assistant, open Settings › Apps, open the store and choose Reload from the top-right menu. RingLife appears among the local apps.

4. **Install.** Install RingLife. The first build can take a few minutes.

5. **Set the pairing secret.** In the Configuration tab, set `pairing_secret`. Generate one, for example with `openssl rand -hex 16`. Treat it as a password: never commit it or paste it in a chat. Goals and time zone already have defaults.

6. **Start.** The log shows these lines, in this order. Log messages are in Italian:

   | Log line | Meaning |
   |---|---|
   | `MQTT collegato: le entita' di RingLife compaiono in Home Assistant.` | MQTT is connected. |
   | `Registrazione dei telefoni attiva.` | Phone registration is on. |
   | `Avvio del backend RingLife.` | The backend is starting. |
   | Flyway lines ending with `Successfully applied ... migrations` | The database schema is ready. |

   Problems:

   - `Servizio MQTT non disponibile` (MQTT service not available): Mosquitto is not running or not reachable.
   - `pairing_secret non impostato` (pairing_secret not set): phone registration is off.
   - `SQLITE_CANTOPEN`: `/data` is not mounted. This should not happen under the Supervisor.

   The log never contains the pairing secret, the MQTT password or health values.

7. **Check the backend.** From a computer on the same network:

   ```bash
   curl http://<server>:8080/actuator/health
   python3 scripts/smoke_test_server.py http://<server>:8080 <secret>
   ```

   The first command answers `{"status":"UP"}`. The second prints `ok` for every check. It registers a `smoke-test-...` device, uploads an invented night twice (no duplicates) and reads the Sleep score.

8. **Check the entities.** Open Settings › Devices & services › MQTT. The device **RingLife** has 13 entities `sensor.ringlife_...`. They appear at startup and stay "unknown" until a device uploads data. After the smoke test, the Sleep score, sleep start, sleep end and last sync show the invented night. Stop the app: the sensors become "unavailable". Start it again: the values come back.

9. **Remove the test data before real use.** The smoke test data stays in the database, and the entities show it until the phone uploads real data. Before you use a real ring, uninstall and reinstall the app (this deletes `/data` and the database), or run the smoke test on a separate test instance.

10. **Connect the phone.** In the phone app settings, enter the HTTPS address (`https://ringlife.<tailnet>.ts.net`) and check that it is reachable. Then enter the pairing secret to register the phone. Note the phone identifier shown in the settings: you need it to restore the data on a new phone.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `pairing_secret` | password, optional | empty | Secret to register a phone. Treat it as a password. Empty turns registration off: no new phone can connect. It also protects the purge endpoint. |
| `sleep_goal_minutes` | integer, 300-600 | `480` | Sleep goal in minutes (480 is 8 hours). |
| `steps_goal` | integer, 1000-50000 | `8000` | Daily steps goal. |
| `timezone` | string | `Europe/Rome` | Time zone that assigns data to days. |
| `weather_entity` | string, optional | empty | Home Assistant weather entity for the air pressure, for example `weather.<your_entity>` (see Developer tools › States). The migraine plugin uses it for its pressure drop condition. Empty means no weather reading. |
| `uv_entity` | string, optional | empty | Sensor with the UV index for the vitamin D plugin, for example `sensor.<your_uv_sensor>`. Empty means the `uv_index` attribute of the weather entity, if it has one. UV readings start only when `weather_entity` is set. |
| `apns_key` | password, optional | empty | Content of the Apple Push Notification service key file (`.p8`) for encrypted push notifications. One line without the `BEGIN`/`END` lines also works. Treat it as a password. |
| `apns_key_id` | string, optional | empty | Key ID of the `.p8` key (10 characters). |
| `apns_team_id` | string, optional | empty | Your Apple Developer Team ID. |
| `apns_topic` | string, optional | empty | Bundle ID of the app that receives the pushes. Empty = `com.ringlife.app`. Set it to the bundle ID you built the app with. |

Push notifications are on only when the three `apns_*` options are set. Without them, the phone shows alerts as local notifications when it reads the ring. With them, the server must reach `api.push.apple.com` on port 443. The push carries title and text encrypted; see [api.md](api.md#push-notifications). You need your own Apple Developer account and the app built with your bundle id ([ios-build.md](ios-build.md#push-notifications)).

Restart the app after you change an option.

`run.sh` passes the options to the backend as environment variables:

| Option | Environment variable |
|---|---|
| `pairing_secret` | `RINGLIFE_PAIRING_SECRET` |
| `sleep_goal_minutes` | `RINGLIFE_GOALS_SLEEP_MINUTES` |
| `steps_goal` | `RINGLIFE_GOALS_STEPS` |
| `timezone` | `RINGLIFE_ZONE` |
| `weather_entity` | `RINGLIFE_WEATHER_ENTITY` |
| `uv_entity` | `RINGLIFE_WEATHER_UV_ENTITY` |
| `apns_key` | `RINGLIFE_APNS_KEY` |
| `apns_key_id` | `RINGLIFE_APNS_KEY_ID` |
| `apns_team_id` | `RINGLIFE_APNS_TEAM_ID` |
| `apns_topic` | `RINGLIFE_APNS_TOPIC` |

It also sets `RINGLIFE_DB_PATH=/data/ringlife.sqlite`, `PORT=8080`, and `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD` from the Supervisor MQTT service. The weather client calls `http://supervisor/core/api` with the Supervisor token (`homeassistant_api: true`).

## Network and TLS

- The app exposes port 8080 on the host (`ports: 8080/tcp: 8080`).
- Port 8080 must be reachable only from the home network and from Tailscale. **Never forward it on the router and never expose it to the internet.** The API carries health data and has no request rate limit.
- The phone needs HTTPS. iOS blocks plain HTTP (App Transport Security), and Android blocks it from API level 28.
- HTTPS comes from **Tailscale Serve**, with the Tailscale certificate. **Never use Tailscale Funnel**: Funnel publishes the service on the internet.
- One working setup: in the Tailscale app on Home Assistant, a service `svc:ringlife` that points to `http://127.0.0.1:8080`, with `advertise_tags: [tag:ringlife]`. The node must be tagged in the Tailscale admin console. Otherwise the service does not appear among the hosts, with the error `service hosts must be tagged nodes`. The phone then uses `https://ringlife.<tailnet>.ts.net`.
- TLS ends at the Tailscale proxy. The backend trusts `X-Forwarded-For` and `X-Forwarded-Proto` only from loopback and private addresses, and ignores them from anywhere else.
- Optional: the phone app also accepts a home network address in plain HTTP, such as `http://<server>:8080`. It accepts only private IPv4 addresses and `.local` names, and tries this address only when the HTTPS address does not answer. On the home Wi-Fi this traffic is not encrypted. On the first connection iOS asks for local network access: allow it. Reserve the server address on your router (DHCP) so that it does not change.

## Third-party licenses

The app package and the container image contain `THIRD-PARTY-LICENSES.txt` (in the image: `/opt/ringlife/THIRD-PARTY-LICENSES.txt`). It lists the components of the image (Home Assistant base image, Eclipse Temurin JRE) and every runtime dependency of the server jar with its license. The backend build writes the dependency list with `license-maven-plugin` (`backend/target/generated-sources/license/THIRD-PARTY.txt`). The phone app bundle has its own list, `3rdpartylicenses.txt`, written by the Angular production build.

## Data and backups

- The database is one SQLite file in WAL mode: `/data/ringlife.sqlite`. `/data` is the app data folder, so it is part of Home Assistant backups.
- The app uses `backup: cold`. Home Assistant stops the app during a backup, so the database is never copied in the middle of a write.
- **Backups contain health data.** Limit their retention, keep them encrypted, and never store them in the repository.
- Uninstalling the app deletes `/data` and the database.
- To delete old data without reinstalling, use the purge endpoint in [api.md](api.md#purge-old-data). It needs the pairing secret.
- The phone app keeps data not yet sent in a local queue and uploads it when the server answers again. A server that is off for a while does not lose ring data.

## Entities

The backend publishes its results through MQTT discovery. Home Assistant shows one device, **RingLife** (model `R09`), with the sensors below. The entity ids are a stable contract for your automations. The display names in Home Assistant are in Italian.

| Entity | What it is | Unit |
|---|---|---|
| `sensor.ringlife_sleep_index` | Sleep score, 0-100 | |
| `sensor.ringlife_movement_index` | Movement score, 0-100 (yesterday's: today is in progress) | |
| `sensor.ringlife_recovery_score` | Recovery score, 0-100 | |
| `sensor.ringlife_stress_rhythm` | Stress score, 0-100 (yesterday's). Higher means a calmer day. | |
| `sensor.ringlife_sleep_debt` | Sleep debt over the last 7 days | `h` |
| `sensor.ringlife_resting_hr` | Resting heart rate last night | `bpm` |
| `sensor.ringlife_hrv` | Heart rate variability (HRV) last night | `ms` |
| `sensor.ringlife_temp_deviation` | Night temperature deviation from your baseline | `°C` |
| `sensor.ringlife_sleep_start` | Start of the last sleep | timestamp |
| `sensor.ringlife_sleep_end` | End of the last sleep | timestamp |
| `sensor.ringlife_steps_today` | Steps today | `passi` (Italian for "steps") |
| `sensor.ringlife_last_sync` | Last upload from the phone | timestamp |
| `sensor.ringlife_migraine_risk` | Migraine risk from the migraine plugin: `low`, `medium` or `high` | |
| `sensor.ringlife_alerts` | Alerts not yet seen in the app (optional, see below) | `avvisi` (Italian for "alerts") |

**Values.** Each sensor shows the latest value of the last 7 days. A score that does not exist yet today shows yesterday's. Steps today count only for today. A sensor without any data is "unknown": the backend never invents a value. The sensors update after every upload from the phone, after every diary sync and every night.

**Attributes.** The four scores have the attributes `day` (the day of the value), `algo_version` (the formula version) and `components` (the contributors with weight and score).

**Availability.** When the backend stops, the sensors become "unavailable".

**Migraine risk.** `sensor.ringlife_migraine_risk` is an `enum` sensor with the values `low`, `medium` and `high`. Its attributes are `score` (0-100), `evaluated` (how many of the 10 conditions it could evaluate) and `contributors` (the conditions that count, with their points). It is not a diagnosis: it is a rule-based estimate with initial thresholds. Air pressure counts only when you set `weather_entity` and there are at least two readings one day apart. The sensor is "unknown" when the plugin is off or has too little data.

**Alerts (optional).** `sensor.ringlife_alerts` exists only when publishing to Home Assistant is on in the phone alert settings (off by default). Its state is the number of alerts not yet seen in the app (unit `avvisi`). Its attributes are `title`, `level` (`attenzione` or `alto`) and `day` of the newest alert, empty when there is none. When you turn publishing off, the backend removes the entity (empty discovery config). The title names the problem, for example «Temperatura della notte sopra il tuo solito». If an automation forwards it with the Home Assistant companion app notifications, it travels through their push services: prefer a generic text in the message.

**Not published yet.** `sensor.ringlife_battery` (ring battery) does not exist yet.

**MQTT details.**

| Item | Value |
|---|---|
| Discovery topic | `<prefix>/sensor/ringlife/<key>/config`, prefix `homeassistant` by default (`MQTT_DISCOVERY_PREFIX`) |
| State topic | `ringlife/<key>/state` |
| Attributes topic | `ringlife/<key>/attributes` |
| Availability topic | `ringlife/availability`, payloads `online` and `offline` |
| `unique_id` | `ringlife_<key>` |
| Entity id | `default_entity_id: sensor.ringlife_<key>` |
| Retain | Config, state and attribute messages are retained. |
| Unknown state | The backend publishes `None`. |

### Example automations

These are examples to copy into your own Home Assistant configuration. RingLife does not create automations. Sensor states are text: read numbers with `float`.

**Notify at 08:00 when the migraine risk is high:**

```yaml
alias: RingLife - high migraine risk
trigger:
  - platform: time
    at: "08:00:00"
condition:
  - condition: state
    entity_id: sensor.ringlife_migraine_risk
    state: "high"
action:
  - service: notify.notify
    data:
      title: High migraine risk
      message: "Today the risk is high. See the details in RingLife."
```

**Notify when the phone has not uploaded for more than 48 hours:**

```yaml
alias: RingLife - no upload for more than 48 hours
trigger:
  - platform: time
    at: "09:00:00"
condition:
  - condition: template
    value_template: >
      {% set last = states('sensor.ringlife_last_sync') | as_datetime %}
      {{ last is not none and (now() - last).total_seconds() > 172800 }}
action:
  - service: notify.notify
    data:
      message: "The phone has not uploaded data to RingLife for more than 48 hours."
```

**Notify when the ring battery is below 20%.** This needs `sensor.ringlife_battery`, which is not published yet. The example does not work until it is.

```yaml
alias: RingLife - low ring battery
trigger:
  - platform: numeric_state
    entity_id: sensor.ringlife_battery
    below: 20
action:
  - service: notify.notify
    data:
      message: "The ring battery is below 20%."
```

## Updating

The Supervisor shows an update only when `version` in `config.yaml` changes. Data in `/data` stays across updates.

Installed from the app repository, the app updates from Home Assistant like any other app: open it and choose Update. The sections below are for the local app.

### Releases

Each release is a GitHub release `vX.Y.Z`. It contains `ringlife-ha-app.tar.gz` (the app folder, with the jar) and `ringlife-ha-app.tar.gz.sha256`. App and server share one version number, and `CHANGELOG.md` lists the changes. Home Assistant shows the app `CHANGELOG.md` when an update is available.

### With the update script

`scripts/update-ha-app.sh` runs **on the Home Assistant server**, in the SSH app terminal. The server asks GitHub for the latest release. GitHub never reaches your home network, and no port opens.

**Once:**

With a public repository no token is needed: skip steps 1 and 2, the script asks GitHub without authentication. Set `RINGLIFE_REPO=<owner>/<repo>` if you install from a fork. The token is only for a private repository.

1. Create a GitHub fine-grained personal access token. Give it access to this repository only, with the permission **Contents: Read-only** and a short expiry (30-90 days). Create a new one when it expires. Never put it in the repository or in a chat.
2. Store the token on the server, in the SSH app terminal:

   ```bash
   mkdir -p /share/ringlife
   read -r -s TOKEN && printf '%s' "$TOKEN" > /share/ringlife/update.token && unset TOKEN
   chmod 600 /share/ringlife/update.token
   ```

   Paste the token after the first command and press Enter. The token is not shown.

   > **Warning.** Home Assistant Core and custom integrations also read `/share`, and they run as root. `chmod 600` does not stop them. This is why the token must be able to do very little: one repository, read-only, short expiry. Whoever reads it sees the app code, not health data: health data stays in the app `/data` folder.

3. Copy `scripts/update-ha-app.sh` to `/share/ringlife/update-ha-app.sh` with the Samba or SSH app. Copy it again only when the script changes.
4. Check that the SSH app sees the local apps folder and the `ha` command: `ls /local_apps` and `ha info`.

**For each update:**

```bash
sh /share/ringlife/update-ha-app.sh
```

The script:

1. Reads the latest release. If it is the release already installed, it stops (`--force` reinstalls it).
2. Downloads the package and its `.sha256`, and checks the checksum. On a mismatch it installs nothing.
3. Checks that the package contains `config.yaml`, `Dockerfile`, `run.sh`, `ringlife-backend.jar`, `icon.png` and `logo.png`.
4. Replaces the content of `/local_apps/ringlife` (or `/addons/ringlife`).
5. Runs `ha store reload`, or `ha apps reload` when `ha store` does not exist.
6. Waits until the Supervisor sees the new version (up to 90 seconds).
7. Runs `ha apps update local_ringlife`, or `ha apps rebuild local_ringlife` if the update fails. Older Home Assistant versions use `ha addons` instead of `ha apps`.
8. Marks the release as installed, in `.release-tag`. It does so only after the update succeeds, or after the copy when `ha` is not available. A failed update is retried on the next run without `--force`.

The token never appears in logs or in the process list: curl reads it from a temporary header file.

If the script says that the Supervisor does not see the new version yet, run it again in a moment. You can also update by hand: `ha store reload`, then `ha apps update local_ringlife`. If `ha` is not available in the terminal, the script copies the files and asks you to reload and update the app from the Home Assistant UI.

Script variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `RINGLIFE_TOKEN_FILE` | `/share/ringlife/update.token` | File with the read-only GitHub token |
| `RINGLIFE_REPO` | the project repository | `owner/repo` that publishes the releases |
| `RINGLIFE_APP_DIR` | `/local_apps/ringlife` if `/local_apps` exists, otherwise `/addons/ringlife` | Local app folder |
| `RINGLIFE_APP_SLUG` | `local_ringlife` | App slug in the Supervisor |
| `RINGLIFE_API` | `https://api.github.com` | GitHub API base (used by tests) |
| `RINGLIFE_WAIT_SECONDS` | `90` | How long to wait for the Supervisor to see the new version |
| `RINGLIFE_POLL_SECONDS` | `3` | Interval between checks |

Limits:

- The update is not fully automatic: you start the script from the SSH terminal. A Home Assistant `shell_command` runs in the Core container, which sees neither the apps folder nor `ha`. You can run the script from the phone, in the Home Assistant app terminal.
- On a real Supervisor, `ha apps reload` did not show the new version of a local app, and `ha store reload` did. The script uses `ha store reload` first for this reason.

### Manual copy

1. Get the new app folder: extract `ringlife-ha-app.tar.gz` from a release, or build it with `sh scripts/package-ha-app.sh`. A local build needs a higher `version` in `ha-app/ringlife/config.yaml`.
2. Copy the folder to `/local_apps/ringlife`, replacing the old files.
3. Run `ha store reload` (or use Reload in the app store).
4. Press Update on the RingLife app page, or run `ha apps update local_ringlife`.

## Health check

```bash
curl http://<server>:8080/actuator/health
curl https://ringlife.<tailnet>.ts.net/actuator/health
```

Both answer `{"status":"UP"}`. The endpoint shows no details and no health data. The app watchdog uses the same endpoint (`http://[HOST]:[PORT:8080]/actuator/health`) and restarts the app when it does not answer.

For a full check of a running server, use `python3 scripts/smoke_test_server.py <url> <secret>` (see [Install as a local app](#install-as-a-local-app), step 7).

## Verification status

Tested in a lab, without a Supervisor:

- The Docker image builds (Home Assistant Debian `trixie` base and Java 25 runtime).
- `run.sh` runs with the real bashio against a fake Supervisor: options, MQTT service, backend environment variables, no secret in the logs.
- The backend in the image: Flyway migrations, health check, database in `/data`, restart with the data kept.
- A real Mosquitto: discovery configs, retained states and availability, also after a backend restart.
- A real Home Assistant 2026.10.4 accepts the 12 base sensors as `sensor.ringlife_<key>`, with units, classes and attributes, and marks them `unavailable` when the backend stops. The 48-hour sync automation above works.

Tried on a real Supervisor: the update path, where `ha store reload` makes the new version of the local app visible.

The project install checklist still lists these items as not verified on a real Supervisor:

- That the Supervisor accepts `config.yaml`. The official app linter (`frenck/action-addon-linter`) has not been run on `ha-app/ringlife`. Run it before you install.
- The image build by the Supervisor, and port 8080 reachable from the network.
- The watchdog: stop the backend abnormally and check that it restarts.
- The cold backup: the app stops during a backup and starts again.

## Logs

Read the log in the Log tab of the app. The log contains no health values, no pairing secret and no MQTT password. Messages are in Italian.
