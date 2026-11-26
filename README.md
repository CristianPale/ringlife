<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ringlife-horizontal-dark.svg">
    <img src="docs/assets/ringlife-horizontal-light.svg" alt="RingLife" width="420">
  </picture>
</p>

<p align="center">
  <b>A self-hosted health dashboard for a 30 € smart ring.</b><br>
  Your ring, your phone, your Home Assistant server. No cloud.
</p>

<p align="center">
  <a href="https://github.com/CristianPale/ringlife/releases/latest"><img src="https://img.shields.io/github/v/release/CristianPale/ringlife?style=flat&color=76d3b4&labelColor=14120f" alt="Latest release"></a>
  <a href="https://github.com/CristianPale/ringlife/actions/workflows/backend.yml"><img src="https://img.shields.io/github/actions/workflow/status/CristianPale/ringlife/backend.yml?branch=main&style=flat&label=server&labelColor=14120f" alt="Server build"></a>
  <a href="https://github.com/CristianPale/ringlife/actions/workflows/mobile.yml"><img src="https://img.shields.io/github/actions/workflow/status/CristianPale/ringlife/mobile.yml?branch=main&style=flat&label=app&labelColor=14120f" alt="App build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-76d3b4?style=flat&labelColor=14120f" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/tested%20on-iOS-f3ece0?style=flat&labelColor=14120f" alt="Tested on iOS">
  <img src="https://img.shields.io/badge/Android-available%2C%20untested-c9a96b?style=flat&labelColor=14120f" alt="Android: available, untested">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/home-assistant.md">Server guide</a> ·
  <a href="docs/ios-build.md">Build the app</a> ·
  <a href="docs/scores.md">Formulas</a> ·
  <a href="docs/protocol.md">Ring protocol</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

RingLife turns a Colmi R09 smart ring into a personal health dashboard that you host yourself. The phone reads the ring over Bluetooth and sends the data to a server running as a Home Assistant app. The server compares every night and every day with your own 28-day average, computes daily scores and runs small plugins. Nothing leaves your home.

> [!IMPORTANT]
> RingLife is not a medical device. Its scores, estimates and alerts are not diagnoses and are no substitute for a doctor.

## Quick start

| You have | Do this |
|---|---|
| **Home Assistant OS** (amd64) with the Mosquitto app | Add this repository as an app repository, install **RingLife**, set a pairing secret. [![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https://github.com/CristianPale/ringlife) |
| **An iPhone and an Apple developer account** | Build the app with the included GitHub Actions workflow and install it from TestFlight: [docs/ios-build.md](docs/ios-build.md). There is no App Store listing. |
| **An Android phone** | Install the APK from the [latest release](https://github.com/CristianPale/ringlife/releases/latest). Available but untested, and it syncs only while the app is open: [docs/android.md](docs/android.md). |
| **A Colmi R09 ring** | Close the vendor app, open RingLife and follow the first-run setup: server address, pairing secret, ring. The parsers were checked on firmware 3.00.03. |
| **Tailscale** (optional) | Sync from outside home over HTTPS, with no port open to the internet: [docs/home-assistant.md](docs/home-assistant.md#network-and-tls). |

Full server guide, options and updates: [docs/home-assistant.md](docs/home-assistant.md).

> [!NOTE]
> **RingLife is tested on iOS only.** The Android app is built from the same code and is available in every release, but nobody has tested it on a real phone yet. It has no background reading and no push notifications. Details in [docs/android.md](docs/android.md).

## What you get

| | |
|---|---|
| **Daily scores** | Recovery, Sleep, Movement and Stress on a 0-100 scale, plus sleep debt in hours. Each one shows its contributors and how today compares with your usual range. [Formulas](docs/scores.md) |
| **Sleep** | Sleep stages from the ring, regularity, night heart rate, HRV, skin temperature deviation and night SpO2. |
| **Alerts** | Built-in rules (fatigue, night temperature, resting heart rate, HRV, night breathing, low recovery, migraine risk) and up to 20 rules of your own. Optional end-to-end encrypted push notifications. [API](docs/api.md#alerts) |
| **Plugins** | Weekly report, migraine diary with a rule-based risk and a report for your doctor, caffeine window, circadian rhythm, social jetlag, vitamin D. [Plugins](docs/plugins.md) |
| **In the app** | Live heart rate for training and guided breathing, measure-now for heart rate, SpO2, HRV, stress and temperature, a diary, trends over 7, 30 and 90 days, cardio age. |
| **Home Assistant** | Sensors through MQTT discovery for your own automations, with examples. [Entities](docs/home-assistant.md#entities) |
| **Background sync** | iOS background refresh and Shortcuts automations read the ring while the app is closed. |

The app interface is in Italian. The documentation is in English.

## How it works

```
[Colmi R09] --BLE--> [iPhone app] --HTTPS (Tailscale)--> [RingLife server, Home Assistant app] --> [SQLite]
                                                              |--MQTT discovery--> [Home Assistant sensors]
                                                              |--Home Assistant API (weather, UV, pressure)
```

| Step | What happens |
|---|---|
| **Read** | The phone is the only Bluetooth client of the ring. It sets the clock, reads the history and disconnects. |
| **Queue** | Data waits on the phone until the server answers, so a server that is off loses nothing. |
| **Compute** | The server stores raw data, builds your personal baselines and computes scores, plugins and alerts. Every formula has a version. |
| **Show** | The app shows the server results. Home Assistant gets sensors for your automations. |

The ring protocol was reconstructed from observed Bluetooth traffic and is documented in [docs/protocol.md](docs/protocol.md).

## Privacy

- Health data stays on your phone and your server. RingLife adds no cloud service that receives health data.
- The Home Assistant app downloads its image from GitHub Container Registry. After that it calls nothing on the internet, except Apple's push service if you turn encrypted push on. Apple sees only an encrypted payload.
- Never post real health data, ring MAC addresses, tokens or home network details in issues or pull requests. See [SECURITY.md](SECURITY.md).

## Documentation

| Document | Content |
|---|---|
| [docs/home-assistant.md](docs/home-assistant.md) | Install, options, network and TLS, data and backups, entities, updates |
| [docs/ios-build.md](docs/ios-build.md) | Build and sign the iPhone app, TestFlight, background reading, push notifications |
| [docs/android.md](docs/android.md) | Android app: what works, what is missing, install and build (untested) |
| [docs/api.md](docs/api.md) | Server HTTP API |
| [docs/scores.md](docs/scores.md) | Formulas of scores, baselines and estimates |
| [docs/plugins.md](docs/plugins.md) | Plugin contract and the built-in plugins |
| [docs/protocol.md](docs/protocol.md) | Colmi R09 Bluetooth protocol |

## Repository layout

| Path | Content |
|---|---|
| `mobile/` | Phone app (Ionic, Angular, Capacitor), iOS and Android projects |
| `backend/` | Server (Spring Boot, Java 25, SQLite, Flyway) |
| `ha-app/ringlife/` | Home Assistant app: `config.yaml`, `Dockerfile`, `run.sh` |
| `scripts/` | Packaging, update and release helpers |
| `tools/` | Python tools used to study the ring protocol from captures |
| `docs/` | Guides and references |

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: Conventional Commits, tests with synthetic data only, and a line in [CHANGELOG.md](CHANGELOG.md) for every visible change.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party licenses of the server are in `THIRD-PARTY-LICENSES.txt` inside the Home Assistant app.

RingLife is not affiliated with the maker of the Colmi R09.
