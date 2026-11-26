# RingLife

Personal server for the Colmi R09 ring. It receives the data from the phone app, computes daily indices (Recovery, Sleep, Movement, Stress, sleep debt) against your own average, runs the plugins and sends the results back to the app. It is not a medical device: estimates and suggestions are not diagnoses.

The full guide is in `docs/home-assistant.md` of the repository.

## Options

| Option | Meaning |
|---|---|
| `pairing_secret` | Secret used to register a phone. Treat it like a password. Empty = registration off: no new phone can connect. |
| `sleep_goal_minutes` | Sleep goal in minutes (300-600). Default 480, that is 8 hours. |
| `steps_goal` | Daily steps goal (1,000-50,000). Default 8,000. |
| `timezone` | Time zone used to assign data to days. Default `Europe/Rome`. |
| `weather_entity` | Home Assistant weather entity used to read the atmospheric pressure, for example `weather.your_entity` (see Developer tools › States). Used by the "pressure drop" condition of the Migraine plugin. Empty = no reading. |
| `uv_entity` | Optional. Sensor with the UV index, for example `sensor.your_uv_sensor`, for the Vitamin D plugin. Empty = the `uv_index` attribute of the weather entity, if it has one. UV readings start only when `weather_entity` is set. |
| `apns_key` | Optional and secret. Content of the Apple APNs key file (`.p8`), also on one line without the `BEGIN`/`END` lines. Needed for push notifications (below). Empty = push off. |
| `apns_key_id` | Optional. ID of the APNs key (10 characters, from the Apple Developer portal). |
| `apns_team_id` | Optional. Your Apple Developer team ID (10 characters). |
| `apns_topic` | Optional. Bundle ID of the app that receives the pushes. Empty = `com.ringlife.app`. Set it to the bundle ID you built the app with. |

Restart the app after changing an option.

## Push notifications

With `apns_key`, `apns_key_id` and `apns_team_id` set, the server sends alerts to the iPhone also when the app is closed, through the Apple Push Notification service (APNs). Without them, alerts arrive when the app opens or reads the ring in the background.

Apple does not see the content of the alerts: title and text are encrypted with a key that the phone creates and sends only to your server. Apple sees the phone token, the time, the size and the fallback text. Turn push on in the phone app: Impostazioni › Notifiche › «Notifiche dal server di casa». The server must reach `api.push.apple.com` on port 443.

The `.p8` key is a secret: never put it in a repository, a log or a chat. Full setup (APNs key, App IDs, notification extension): `docs/ios-build.md` of the repository.

## Network

The app exposes port 8080 on the host. Reach it from your home network and through Tailscale only, and never open it to the internet: no port forwarding on the router. The phone connects over HTTPS through a Tailscale Serve service, with an address like `https://ringlife.<tailnet>.ts.net`. Never use Tailscale Funnel.

Quick check from the server or a computer on the network: `curl http://<server>:8080/actuator/health` must answer `{"status":"UP"}`.

## Data

The database is a single SQLite file in the app's `/data`, so it is part of Home Assistant backups. The app stops during a backup (`backup: cold`), so the file is never copied in the middle of a write. Keep backups encrypted and limit their retention: they contain health data.

## Logs

The log never contains health values or the pairing secret. Read it from the app's Log tab.

## Entities in Home Assistant

The app uses the Home Assistant MQTT broker (the Mosquitto app, installed and started first) and creates the "RingLife" device with its sensors: indices (Sleep, Movement, Recovery, Stress), sleep debt, resting heart rate, HRV, temperature deviation, sleep start and end, steps today and last sync. Plugins add their own entities, such as the migraine risk. The full list and example automations are in `docs/home-assistant.md`. Sensors update after every upload from the phone and every night. No options are needed: the broker host and credentials come from the Supervisor.
