# Server API

The RingLife server receives raw data from the phone, computes daily scores and plugin results, and returns them to the app. This page describes its HTTP API as implemented in `backend/src/main/java/com/ringlife/backend`.

RingLife is not a medical device. Its scores and estimates are not diagnoses.

## Conventions

- Every endpoint is under the prefix `/api/v1`, except the health check.
- Bodies are JSON.
- Timestamps are milliseconds since the Unix epoch, in UTC.
- A "day" is a local date (`YYYY-MM-DD`) in the server time zone. The time zone is the `timezone` option of the Home Assistant app (default `Europe/Rome`). Sleep belongs to the day you wake up.
- All examples use invented values.

## Authentication

The API uses two credentials.

| Credential | Header | Used by |
|---|---|---|
| Pairing secret | `X-Pairing-Secret: <secret>` | Phone registration and the admin purge |
| Device token | `Authorization: Bearer <token>` | Every route under `/api/v1/devices/{deviceId}/...` |

- The pairing secret is the `pairing_secret` option of the Home Assistant app (environment variable `RINGLIFE_PAIRING_SECRET`). When it is empty, registration and purge are off and answer 404.
- The server compares the secret in constant time.
- A device token is valid only for its own `deviceId`. A token of another device gets the same 401 as a wrong token.
- The server stores only a hash of each token. The token is shown once, in the registration response.
- The server has no request rate limit. Keep it on your home network and Tailscale only (see [home-assistant.md](home-assistant.md)).

## Endpoints

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/v1/devices` | Pairing secret |
| `POST` | `/api/v1/devices/{deviceId}/samples` | Device token |
| `POST` | `/api/v1/devices/{deviceId}/sleep` | Device token |
| `PUT` | `/api/v1/devices/{deviceId}/diary` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/diary` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/days/{day}` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/days?from=...&to=...` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/plugins?day=...` | Device token |
| `PUT` | `/api/v1/devices/{deviceId}/plugins/{pluginId}` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/reports/migraine/summary?days=...` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/reports/migraine?days=...` | Device token |
| `GET`, `PUT` | `/api/v1/devices/{deviceId}/alerts/config` | Device token |
| `POST` | `/api/v1/devices/{deviceId}/alerts/custom` | Device token |
| `PUT`, `DELETE` | `/api/v1/devices/{deviceId}/alerts/custom/{ruleId}` | Device token |
| `GET` | `/api/v1/devices/{deviceId}/alerts?since=...` | Device token |
| `POST` | `/api/v1/devices/{deviceId}/alerts/seen` | Device token |
| `GET`, `PUT`, `DELETE` | `/api/v1/devices/{deviceId}/push` | Device token |
| `POST` | `/api/v1/admin/purge` | Pairing secret |
| `GET` | `/actuator/health` | None |

## Health check

```
GET /actuator/health
```

Response: `{"status":"UP"}`. The endpoint shows no details and no health data. The Home Assistant watchdog uses it.

## Register a phone

```
POST /api/v1/devices
X-Pairing-Secret: <secret>

{ "hardwareId": "stable-id-chosen-by-the-app", "model": "R09", "firmware": "1.0" }
```

| Field | Rules |
|---|---|
| `hardwareId` | Required. At most 100 characters after trimming. A stable identifier that the app chooses. |
| `model` | Required. At most 100 characters. |
| `firmware` | Optional. At most 100 characters. |

Response: `{ "deviceId": "...", "token": "..." }`.

- A new `hardwareId` creates a new device.
- A known `hardwareId` returns the same `deviceId`, updates `model` and `firmware`, issues a new token and revokes all earlier tokens of that device.
- To restore a phone, register again with the same `hardwareId`, then read the diary with `GET .../diary`.

| Status | When |
|---|---|
| 400 | Missing or too long field |
| 401 | Missing or wrong pairing secret |
| 404 | No pairing secret configured: registration is off |

## Upload samples

```
POST /api/v1/devices/{deviceId}/samples
Authorization: Bearer <token>

{ "tzOffsetMin": 60, "samples": [ { "metric": "HR", "ts": 1793577600000, "value": 61 } ] }
```

| Field | Rules |
|---|---|
| `tzOffsetMin` | Required. Offset in minutes between the ring clock and UTC at sync time, from -840 to 840. The server stores it in a sync log with the counts of the upload. |
| `samples` | Required. At most 5,000 per request. |
| `samples[].metric` | One of `HR`, `SPO2`, `STRESS`, `HRV`, `TEMP`, `STEPS`, `CALORIES`. |
| `samples[].ts` | From 2020-01-01 to at most one day in the future. |
| `samples[].value` | Any finite number. |

Response: `{ "received": 1, "inserted": 1, "duplicates": 0 }`.

- The upload is idempotent. The unique key is device, metric and `ts`.
- A sample that already exists is never rewritten. A repeated sample with a different value is ignored.
- The server assigns each sample to the local day of its `ts`, not to the sync offset.
- After the upload the server recomputes the days from the oldest uploaded sample to today (at most the last 60 days), evaluates the plugins and publishes to Home Assistant. This happens before the response.

### What each sample means

The server accepts any finite number. The computation expects the shape below, and the ring parsers must produce it. Units marked "assumed" are not confirmed. If the ring behaves differently, fix the parser or the extraction, not the schema.

| Metric | Unit | One sample is | How the server uses it |
|---|---|---|---|
| `HR` | beats per minute | One instant reading at a fixed interval (assumed: every 5 minutes, the interval set in the app). `ts` is the time of the reading. | At night (inside the sleep session): resting heart rate is the median (needs 10 samples), the minimum is the 5th percentile. In the day: each sample at 100 or above counts as one interval of effort (`ringlife.compute.hr-sample-minutes`, default 5; threshold `ringlife.compute.hr-zone-threshold`, default 100). |
| `SPO2` | percent | One saturation reading. | Night only: median and minimum, with at least 10 readings for night breathing. |
| `STRESS` | 0-100 scale (assumed) | One estimate from the ring. | From 07:00 to 23:00 local time: 60 or above is "high". The Stress score needs 8 daytime samples. The day (07-19) and evening (19-23) medians need 3 samples each. |
| `HRV` | milliseconds (assumed) | One heart rate variability reading. | Night only: median (needs 3 samples), compared with your baseline. Only a constant unit matters. |
| `TEMP` | degrees Celsius | Skin temperature at the finger. | Night only: median (needs 3 samples), used as a deviation from your baseline. The absolute value is not meaningful. |
| `STEPS` | steps | The steps of the interval that **ends** at `ts`. Not a running total since midnight. | Summed per local hour (24 values). Gives the daily steps and the active hours (at least 250 steps in the hour). |
| `CALORIES` | kcal | Calories of the interval. | **Not used.** The app estimates calories from steps and profile. You can leave it out. |

Plausible ranges: before upload, the app drops values outside these limits and reports them in its settings. Heart rate 30-230, SpO2 70-100, stress 0-100, HRV 1-300, temperature 25-42, steps 0-20,000, calories 0-10,000. This shows a broken parser early, for example one byte read instead of two. The server does not check these ranges.

## Upload sleep

```
POST /api/v1/devices/{deviceId}/sleep
Authorization: Bearer <token>

{ "tzOffsetMin": 60, "sessions": [
  { "start": 1793577600000, "end": 1793606400000,
    "stages": [ { "stage": "light", "start": 1793577600000, "end": 1793584800000 } ] } ] }
```

| Field | Rules |
|---|---|
| `tzOffsetMin` | Required, as for samples. |
| `sessions` | Required. At most 31 per request. |
| `sessions[].start`, `end` | Same timestamp range as samples. `end` is after `start`. A session lasts at most 24 hours. |
| `sessions[].stages` | Optional. At most 500 per session. |
| `stages[].stage` | One of `deep`, `light`, `rem`, `awake`. |
| `stages[].start`, `end` | `end` is after `start`. Each stage is inside its session. Stages do not overlap. |

Response: `{ "received": 1, "inserted": 1, "duplicates": 0 }`.

- A session is identified by device and `start`.
- A new session is stored with its stages.
- A known session is rewritten, stages included, only if the new `end` is later. The ring also returns the night in progress, so a reading in the morning extends a reading taken during the night. An extended session counts in `inserted`.
- A shorter or equal version changes nothing and counts in `duplicates`.
- For each day, the server uses the longest session that ends on that day. Naps do not count.
- After the upload the server recomputes, evaluates the plugins and publishes, as for samples.

## Diary

### Send the diary

```
PUT /api/v1/devices/{deviceId}/diary
Authorization: Bearer <token>

{ "entries": [ { "id": "uuid", "ts": 1793577600000, "kind": "caffeine", "drink": "coffee" },
               { "id": "uuid", "ts": 1793577700000, "kind": "note", "text": "short night" } ],
  "episodes": [ { "id": "uuid", "start": 1793577600000, "end": null, "intensity": 6,
                  "intensityLog": [ { "at": 1793577600000, "value": 6 } ], "medicationAt": [],
                  "details": { "symptoms": ["nausea"], "location": "left", "medicationHelp": null,
                               "causes": ["stress"], "notes": "" },
                  "completedAt": null } ],
  "deletedEntries": ["uuid"], "deletedEpisodes": ["uuid"] }
```

All top-level fields are optional.

**Entries** (caffeine, alcohol, notes):

| Field | Values |
|---|---|
| `kind` | `caffeine`, `alcohol` or `note` |
| `drink` | For `caffeine`: `coffee`, `tea`, `energy`, `other`. For `alcohol`: `wine`, `beer`, `spirits`, `other`. |
| `text` | For `note`: not blank, at most 1,000 characters. |

**Headache episodes:**

| Field | Values |
|---|---|
| `start`, `end` | `end` is `null` for an open episode, otherwise not before `start`. |
| `intensity` | 1-10 |
| `intensityLog` | At most 200 points `{ "at", "value" }`, each value 1-10. |
| `medicationAt` | At most 50 timestamps. |
| `details.symptoms` | `photophobia`, `nausea`, `phonophobia`, `aura`, `other` |
| `details.location` | `left`, `right`, `both`, `nape` |
| `details.medicationHelp` | `a_lot`, `a_little`, `not_at_all` |
| `details.causes` | `little_sleep`, `stress`, `skipped_meal`, `weather`, `screens`, `other` |
| `details.notes` | At most 1,000 characters. |
| `completedAt` | Optional timestamp. |

Common rules:

- `id` is generated on the phone: letters, digits, `-` and `_`, at most 64 characters.
- All timestamps are from 2020-01-01 to at most one day in the future.
- At most 500 entries, 100 episodes and 1,000 ids in each deletion list per request.
- An id appears at most once per request, across the upsert list and the deletion list of the same kind.
- An item that already exists is **replaced** with the state received. Repeating the request changes nothing.
- Ids in `deletedEntries` and `deletedEpisodes` are deleted.
- One invalid item rejects the whole request with 400. Nothing is written.

Response: `{ "entries": { "upserted": 2, "deleted": 1 }, "episodes": { "upserted": 1, "deleted": 0 } }`. `deleted` counts the items actually deleted.

After the request the server evaluates the plugins and publishes to Home Assistant.

### Read the diary

```
GET /api/v1/devices/{deviceId}/diary
Authorization: Bearer <token>
```

Returns the stored diary in the same shape (`entries` and `episodes`, oldest first). Use it to restore a new phone.

## Read daily results

```
GET /api/v1/devices/{deviceId}/days/2026-11-12
GET /api/v1/devices/{deviceId}/days?from=2026-11-06&to=2026-11-12
Authorization: Bearer <token>
```

The first form returns one day. The second returns a list with one element per day, including days without data. `to` cannot be before `from`, and is at most 120 days after it. An invalid date or range gives 400.

One day:

```
{ "day": "2026-11-12",
  "scores":   { "sleep": { "value": 72, "algoVersion": "v1", "components": [ { "id": "sleep-duration", "weight": 0.3, "score": 73 }, ... ] },
                "recovery": {...}, "movement": {...}, "sleep_regularity": {...} },
  "metrics":  { "sleep_debt": { "value": 5.25, "unit": "h", "detail": null, "algoVersion": "v1" },
                "strain_level": {...}, "spo2_night": {...}, "temp_deviation": {...} },
  "baselines": { "hrv_night": 11, "resting_hr": 11 },
  "features": { "hrv_night": 46.4, "resting_hr": 57.4, "temp_night": 34.5, "steps": 10496 },
  "references": { "hrv_night": { "median": 49.85, "deviation": -0.86, "spread": 6.2 } },
  "scoreReferences": { "sleep": { "median": 74, "deviation": -0.4, "spread": 5.2 } },
  "sleep": { "start": 1793577600000, "end": 1793604600000,
             "stages": [ { "stage": "light", "start": 1793577600000, "end": 1793584800000 } ] },
  "stepsByHour": [0, 0, 0, 0, 0, 0, 0, 0, 969, 603, 936, 825, 963, 606, 699, 728, 889, 730, 768, 937, 843, 0, 0, 0],
  "stressByHour": [null, null, null, null, null, null, null, 34.8, 35.8, 36.1, 40.4, 41.2, 37.1, 52.8, 39.3, 43.7, 38.6, 40.6, 35.1, 26.5, 27, 18.4, 26.2, null] }
```

### `scores`

Scores on a 0-100 scale: `sleep`, `recovery`, `movement`, `stress` and `sleep_regularity`.

- Each score has `value`, `algoVersion` and `components`. A component is `{ "id", "weight", "score" }`, and `score` is `null` when its data was missing.
- A missing score cannot be computed: data is missing or calibration is in progress.
- The current day has no `movement` and no `stress` score.
- Formulas are in [scores.md](scores.md).

### `metrics`

Daily outputs with a unit and no fixed range:

| Key | Unit | Value |
|---|---|---|
| `sleep_debt` | `h` | Sleep debt in hours |
| `strain_level` | `level` | 0 = none, 1 = attention, 2 = high. `detail` has `level` (`none`, `attention`, `high`) and `count`. |
| `spo2_night` | `%` | Night SpO2 median. `detail` has `status`, `count`, `streak`, and `min` and `deviation` when known. |
| `temp_deviation` | `C` | Night temperature minus your baseline median, in degrees |

### `baselines`, `features` and `references`

- `features` are the values of the day extracted from the raw data. Names: `resting_hr` (bpm), `min_hr`, `hrv_night` (ms), `temp_night`, `spo2_median`, `spo2_min`, `spo2_count`, `steps`, `active_hours`, `hr_minutes`, `sleep_asleep_min`, `sleep_in_bed_min`, `sleep_deep_min`, `sleep_light_min`, `sleep_rem_min`, `sleep_awake_min`, `sleep_awakenings`, `sleep_midpoint_min`, `sleep_start_min`, `sleep_end_min`.
- `sleep_start_min` and `sleep_end_min` are minutes after local midnight of the wake-up day. The start is negative before midnight (23:40 is -20).
- Finished days with enough stress readings also have `stress_samples`, `stress_high_share` (0-1), `stress_day_median` and `stress_evening_median`. A median is absent with fewer than 3 readings in its band.
- `baselines` gives, for each feature with a baseline, the number of days behind your baseline. A baseline needs 7 days. An absent feature means calibration is in progress.
- `references` gives, for each feature with a baseline: `median`, `deviation` and `spread`.
  - `deviation` is `(x − median) / (1.4826 · MAD)`, limited to [−3, 3]. Positive means above your baseline. It is `null` when the day has no value.
  - `spread` is one unit of deviation, in the unit of the metric (`1.4826 · MAD`, never below the minimum variability of the metric). Your usual range is `median − 1.5 · spread` to `median + 1.5 · spread`.

### `scoreReferences`

The same `median`, `deviation` and `spread` for each score of the day. The server computes them when you read, from the stored scores of the 28 days before, the day itself excluded. The minimum variability is 3 points. A score with fewer than 7 days of history has no reference: that score is still calibrating.

### `sleep`, `stepsByHour` and `stressByHour`

- `sleep` is the longest session that ends on the day, with its stages, in UTC milliseconds. It is `null` without sleep.
- `stepsByHour` is 24 values, steps per local hour. It is `null` without steps.
- `stressByHour` is 24 values, mean stress per local hour, with `null` for hours without readings. It is `null` without readings.

### When results change

- The server computes after every upload and every night at 04:15 local time (the last 3 days).
- Rows of earlier formula versions stay in the database. The API returns the current version.

## Plugins

Plugins are server modules that add cards and insights for a day. Contract and specifications are in [plugins.md](plugins.md). Registered plugins: `weekly-report`, `migraine`, `caffeine-window`, `circadian`, `social-jetlag`, `vitamin-d`. A plugin is on until you turn it off.

### List plugins

```
GET /api/v1/devices/{deviceId}/plugins?day=YYYY-MM-DD
Authorization: Bearer <token>
```

`day` is optional; the default is today. An invalid date gives 400. The response is a list with one element per registered plugin:

```json
{
  "manifest": { "id": "weekly-report", "name": "...", "description": "...", "version": "1",
                "requires": ["..."], "config": [], "entities": [], "cadence": "weekly" },
  "enabled": true,
  "config": {},
  "result": { "cards": [ { "type": "score", "title": "...", "value": 80, "zone": "buono", "caption": "..." } ],
              "insights": [], "entities": [],
              "headline": { "value": "Sonno +9", "tone": null } }
}
```

- `manifest.config` lists the parameters: `{ "key", "label", "type", "defaultValue", "min", "max" }`. `type` is `INT`, `BOOL` or `TIME`. `min` and `max` apply to `INT` only. A `TIME` value is `HH:mm`.
- `manifest.entities` lists the Home Assistant entities of the plugin: `{ "key", "name", "icon", "options" }`.
- `manifest.cadence` is `daily` or `weekly`: how often the result deserves a look. The app shows `daily` plugins (`migraine`, `caffeine-window`, `vitamin-d`) as one line each on the Today screen, and `weekly` plugins (`circadian`, `social-jetlag`, `weekly-report`) on the Trends tab. An older server does not send it: a client treats it as `daily`.
- `config` is the full configuration: defaults, overwritten by your chosen values.
- `result` is `null` when the plugin is off or the day is not computed yet.
- `result.insights` items are `{ "level", "title", "text" }`, with `level` `info` or `attenzione`.
- `result.entities` items are `{ "key", "state", "attributes" }`.
- `result.headline` is the summary line the app shows next to the plugin name, for example «Emicrania · Rischio basso». `value` is a short Italian phrase (about 24 characters at most). `tone` is `null` or `attenzione`, only when the line deserves a look. `headline` is `null` when the plugin has nothing short to say, for example with too little data. Results stored before this field do not have it: a client treats it as `null`. The headline reuses values the plugin already computes, so the cards and the plugin `version` do not change.
- `result.alerts` is optional. It exists only when the plugin raises an alert: a list of `{ "rule", "title", "body", "values" }`, where `rule` is the alert rule it feeds. Today only the migraine plugin uses it (rule `migraine-risk`, high risk). The server turns it into an alert event (see [Alerts](#alerts)). The app does not read it from here.
- Names and texts are in Italian.

Card types:

| `type` | Fields |
|---|---|
| `score` | `title`, `value` (0-100), `zone` (`ottimo`, `buono` or `attenzione`), `caption` |
| `trend` | `title`, `points` (`null` for days without data), `unit`, `caption` |
| `list` | `title`, `rows` (each `{ "label", "value" }`) |
| `text` | `title`, `body` |
| `action` | `label`, `action`: an app action (`open-diary`, `log-headache`, `open-breathing`), never a URL |

A client ignores card types it does not know.

### Change a plugin

```
PUT /api/v1/devices/{deviceId}/plugins/{pluginId}
Authorization: Bearer <token>

{ "enabled": true, "config": { "<parameter key>": 7 } }
```

The body has `enabled`, `config` or both. For example, `{ "enabled": false }` turns a plugin off.

- `enabled` turns the plugin on or off. When absent, the state stays as it is.
- `config` replaces all chosen values. Keys you leave out go back to their defaults. When `config` is absent, the configuration stays as it is.
- The response is the updated element for today. If the plugin is on, the server evaluates it at once.

| Status | When |
|---|---|
| 400 | Unknown parameter, wrong type or out of range |
| 404 | Unknown plugin |

## Headache report

A report of headache episodes, for the user to share with a doctor. It uses the same device token.

```
GET /api/v1/devices/{deviceId}/reports/migraine/summary?days=90
GET /api/v1/devices/{deviceId}/reports/migraine?days=90
Authorization: Bearer <token>
```

`days` is 30, 90 (default) or 180. Any other value gives 400.

The `summary` form returns JSON:

| Field | Content |
|---|---|
| `from`, `to`, `days` | The period |
| `summary` | `episodes`, `headacheDays`, `peakMax`, `peakAverage`, `medicationDays`, `medicationIntakes`, `averageDurationMin` (`null` if no episode is closed). `summary` is `null` without headaches in the period. |
| `episodes` | One row per episode: `start`, `end`, `peak`, `symptoms`, `location`, `medicationCount`, `medicationHelp`, `causes` |
| `recurrences` | Conditions that occurred much more often on headache days: `label`, `headacheTriggered`, `headacheEvaluated`, `otherTriggered`, `otherEvaluated`. Empty below 5 episodes. |

The second form returns the PDF:

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="report-cefalee-<to>.pdf"`
- `Cache-Control: no-store`

The server builds the PDF in memory and never stores it. The report never contains free-text diary notes, names or other personal details. Symptoms, location, medication effect and causes are the diary codes.

## Alerts

The server checks a set of rules on the computed results and creates alert events. The phone downloads the events and shows them as notifications, or the server sends them as encrypted push notifications (see [Push notifications](#push-notifications)). All routes use the device token.

The server evaluates the rules:

- after each upload, on the recomputed days (at most the last 30);
- after a diary upload;
- after a rule change (today only);
- in the nightly job, next to the plugins.

The rules read features, baselines, scores and metrics that the server already computes. There is no new formula. Rules that compare with your baseline stay silent until the day has a deviation (calibration).

### Configuration

```
GET /api/v1/devices/{deviceId}/alerts/config
Authorization: Bearer <token>
```

The response has the general settings and every rule, with defaults where the user chose nothing:

```json
{
  "settings": { "quietStart": "22:30", "quietEnd": "07:00", "lockScreen": "breve", "homeAssistant": false },
  "rules": [
    { "id": "temperature", "name": "Temperatura della notte", "description": "...",
      "level": "attenzione", "usesAverage": true,
      "params": { "sensitivity": true, "days": { "min": 2, "max": 7 }, "threshold": null },
      "enabled": true, "sensitivity": "normale", "days": 2, "threshold": null, "delivery": "notifica" },
    { "id": "recovery-low", "name": "Recupero basso", "description": "...",
      "level": "attenzione", "usesAverage": true,
      "params": { "sensitivity": false, "days": { "min": 1, "max": 7 },
                  "threshold": { "unit": "punti", "min": 30, "max": 90, "step": 1 } },
      "enabled": true, "sensitivity": null, "days": 3, "threshold": 70, "delivery": "notifica" }
  ],
  "custom": [],
  "metrics": [],
  "maxCustom": 20
}
```

`custom`, `metrics` and `maxCustom` belong to custom rules (next section).

Built-in rules:

| `id` | Condition | Parameters (default) | Level | On by default | App page (`route`) |
|---|---|---|---|---|---|
| `fatigue` | `strain_level` at "high" (three signals out of three) | none | `alto` | yes | `/indici/recupero` |
| `temperature` | `temp_night` deviation ≥ +S, or ≥ +1 for N nights in a row | S, N = 2 (2-7) | `attenzione` | yes | `/indici/recupero` |
| `resting-hr` | `resting_hr` deviation ≥ +S, or ≥ +1 for N nights | S, N = 3 (2-7) | `attenzione` | yes | `/indici/recupero` |
| `hrv` | `hrv_night` deviation ≤ −S, or ≤ −1 for N nights | S, N = 3 (2-7) | `attenzione` | yes | `/indici/recupero` |
| `breathing` | `spo2_night` status "to watch" (`detail.status` = `watch`) | none | `alto` | yes | `/tabs/sonno` |
| `recovery-low` | Recovery below the threshold for N days in a row | threshold 70 points (30-90), N = 3 (1-7) | `attenzione` | yes | `/indici/recupero` |
| `migraine-risk` | The migraine plugin gives high risk (`result.alerts`) | none | `alto` | yes, only with the plugin on | `/plugin/migraine` |
| `sleep-debt` | `sleep_debt` above the threshold; `deliverAfter` at 21:00 of the day | threshold 6 h (1-20, step 0.5) | `attenzione` | no | `/tabs/sonno` |
| `steps-low` | Steps below the threshold for N finished days in a row (never today) | threshold 4000 steps (500-20000, step 100), N = 3 (1-7) | `attenzione` | no | `/indici/movimento` |

- **Only after the night is over.** Every rule except `steps-low` depends on the night that ends on the evaluated day. For that day the rule stays silent until the night is over. The night of day D is over only when the server has samples of the device, of any metric, at least 30 minutes after the end of the sleep session of D (the longest session that ends on D, as in the computation). After waking up the ring keeps measuring, while a night read at 3 a.m. ends at 3 a.m. with nothing after it. A day without a sleep session has no night alerts. When a later upload completes the night, the next evaluation creates the event as usual. An event already written never changes.
- Sensitivity S: `sensibile` 1.5, `normale` 2 (default), `grandi` 2.5 deviations. "N nights in a row" means N consecutive days that end on the evaluated day, each with the weak condition (±1). The strong condition (S) is enough on a single day. A day without data breaks the series.
- Delivery: `notifica` (default), `importante` (a time-sensitive notification that breaks through Focus) or `elenco` (only in the app list). The server stores it and uses it for push.
- `params` says which parameters a rule has and their ranges. `step` is the step the app offers. A parameter the rule does not have is `null`. `usesAverage` is true for rules that start from the eighth night.
- `lockScreen` is `breve` (title and text on the lock screen) or `generico` (only "RingLife" and a generic text).
- `homeAssistant` publishes `sensor.ringlife_alerts` (see [home-assistant.md](home-assistant.md#entities)).

```
PUT /api/v1/devices/{deviceId}/alerts/config
Authorization: Bearer <token>

{ "settings": { "quietStart": "23:00" }, "rules": { "temperature": { "sensitivity": "sensibile", "days": 3 } } }
```

- The body has `settings` (`quietStart`, `quietEnd`, `lockScreen`, `homeAssistant`), `rules` (by id: `enabled`, `sensitivity`, `days`, `threshold`, `delivery`) or both. Only the fields present change. A `null` field counts as absent.
- Times are `HH:mm`.
- The response is the full configuration.
- If a rule changes, the server evaluates today again at once.
- This route is for built-in rules only. The id of a custom rule here is an unknown rule.

| Status | When |
|---|---|
| 400 | Unknown rule («Regola sconosciuta»), a parameter the rule does not have («Parametro non previsto: temperature.threshold») or a value out of range («Parametro non valido: temperature.days»). Nothing is written. |

### Custom rules

The user can build up to 20 rules per device: metric, comparison, amount, days in a row, level and delivery. The server evaluates them in the same pass as the built-in rules, with the same limit of one event per rule and day.

`GET .../alerts/config` lists them in `custom`, with the catalogue of metrics in `metrics`:

```json
{
  "custom": [
    { "id": "custom-3fa91c0e", "name": "Passi sotto 3.000 per 3 giorni di fila", "metric": "steps", "comparison": "below",
      "amount": 3000, "days": 3, "level": "attenzione", "delivery": "notifica", "enabled": true }
  ],
  "metrics": [
    { "id": "resting_hr", "name": "Battito a riposo", "unit": "battiti al minuto", "night": true, "average": true,
      "value": { "min": 30, "max": 120, "step": 1 } },
    { "id": "temperature", "name": "Temperatura della notte", "unit": null, "night": true, "average": true, "value": null }
  ],
  "maxCustom": 20
}
```

| `metric` | `unit` | Night | Baseline comparison | Value range (min-max, step) | Read from | `route` |
|---|---|---|---|---|---|---|
| `resting_hr` | battiti al minuto | yes | yes | 30-120, 1 | feature `resting_hr` | `/indici/recupero` |
| `hrv` | ms | yes | yes | 5-200, 1 | feature `hrv_night` | `/indici/recupero` |
| `temperature` | `null` | yes | yes | baseline only | feature `temp_night` | `/indici/recupero` |
| `spo2` | `null` | yes | yes | baseline only | feature `spo2_median` | `/tabs/sonno` |
| `sleep_hours` | h | yes | no | 2-12, 0.5 | feature `sleep_asleep_min` / 60 | `/tabs/sonno` |
| `sleep_debt` | h | yes | no | 1-20, 0.5 | metric `sleep_debt` | `/tabs/sonno` |
| `sleep_score` | punti | yes | no | 0-100, 1 | score `sleep` | `/tabs/sonno` |
| `recovery_score` | punti | yes | no | 0-100, 1 | score `recovery` | `/indici/recupero` |
| `stress_score` | punti | no | no | 0-100, 1 | score `stress` | `/indici/stress` |
| `movement_score` | punti | no | no | 0-100, 1 | score `movement` | `/indici/movimento` |
| `steps` | passi | no | no | 500-30000, 500 | feature `steps` | `/indici/movimento` |

- `comparison`:
  - `above_average` and `below_average`: the day's deviation from the baseline is ≥ +N or ≤ −N. `amount` = N, from 1 to 3, step 0.5. Only for metrics with `average`.
  - `above` and `below`: the day's value is strictly above or below `amount`, in the metric unit. Only for metrics with `value`.
- `days` 1-7: N consecutive days that end on the evaluated day, each with the condition. A day without data breaks the series.
- `level` `attenzione` or `alto`. `delivery` `notifica` (default), `importante` or `elenco`.
- **Night metrics** (`night: true`): a day is evaluated only after the night is over, as for the built-in rules. **Day metrics** (steps, Stress, Movement): only finished days, never today. Baseline comparisons stay silent until the deviation exists.
- The server writes `name` in Italian, in the same format as the app preview, for example «Passi sotto 3.000» or «Battito a riposo sopra la tua media di 2 scostamenti», followed by « per N notti di fila» or « per N giorni di fila» when `days` > 1. There are no free-text names.
- An event of a custom rule has `rule` = the rule id, the rule `level` and `delivery`, and the metric `route`. Its body always ends with «Avviso creato da te.».

```
POST   /api/v1/devices/{deviceId}/alerts/custom
PUT    /api/v1/devices/{deviceId}/alerts/custom/{ruleId}
DELETE /api/v1/devices/{deviceId}/alerts/custom/{ruleId}
Authorization: Bearer <token>
```

- `POST` with `{ "metric", "comparison", "amount", "days", "level", "delivery"?, "enabled"? }` creates a rule. Its id is `custom-` plus 8 hex characters.
- `PUT` changes the fields present (a `null` field counts as absent) and checks the whole rule. For example, changing only the metric of an `above` rule to `temperature` gives 400.
- `DELETE` removes the rule and keeps the events it already created.
- All three return the full configuration.
- After a create or a change, the server evaluates today again for night metrics, and yesterday for day metrics.

| Status | When |
|---|---|
| 400 | Missing field («Campo obbligatorio: metric»), unknown metric, a comparison the metric does not have, an amount out of range or off the step, invalid `days`, `level` or `delivery`, the 21st rule («Al massimo 20 avvisi tuoi»). Nothing is written. |
| 404 | A rule that does not exist or belongs to another device («Regola sconosciuta») |

### Events

```
GET /api/v1/devices/{deviceId}/alerts?since=<ms>
Authorization: Bearer <token>
```

The response has the events created from that instant on, newest day first (without `since`, the last 30 days; at most 200), and the number of events the device has not seen yet:

```json
{ "events": [ { "id": "6f1c…", "rule": "temperature", "day": "2026-01-14", "level": "attenzione",
                "title": "Temperatura della notte sopra il tuo solito",
                "body": "+0,6 °C rispetto alla tua media, la seconda notte di fila. ...",
                "route": "/indici/recupero", "createdAt": 1768381200000, "deliverAfter": null,
                "seenAt": null, "push": "none" } ],
  "unseen": 1 }
```

- At most one event per rule and day. Once written, an event never changes, except `seenAt`.
- `day` is the local day the event is about. `deliverAfter` (ms or `null`) is the instant before which it must not be notified.
- Texts are in Italian, short and neutral. The title says the problem. The body says how much and since when, with a habit suggestion. Never a diagnosis. Only the night breathing alert suggests a doctor if the drop continues.
- `push`: `none` (push off on the server or the phone, or delivery `elenco`), `pending` (the server will send it), `sent` or `failed`. The phone notifies locally only events with `none` or `failed`. The server delivers the others, so there are no duplicates. A missing field counts as `none`.

```
POST /api/v1/devices/{deviceId}/alerts/seen
Authorization: Bearer <token>

{ "ids": ["6f1c…"] }
```

The body is `{ "ids": [...] }` or `{ "all": true }`. Unknown ids are ignored. The response is `{ "marked": 1, "unseen": 0 }`. Without `ids` or `all`: 400.

## Push notifications

The server can send alerts to the iPhone through the Apple Push Notification service (APNs), with title and text encrypted end to end. Apple sees only the phone token, the time, the size, a fallback text and the interruption level.

The server needs `RINGLIFE_APNS_KEY` (the content of the `.p8` key file, also on one line without the `BEGIN`/`END` lines), `RINGLIFE_APNS_KEY_ID`, `RINGLIFE_APNS_TEAM_ID` and, if the bundle id is not `com.ringlife.app`, `RINGLIFE_APNS_TOPIC`. In the Home Assistant app these are the options `apns_key`, `apns_key_id`, `apns_team_id` and `apns_topic`. Without one of the first three, push is off (`serverReady: false`) and the phone notifies every alert locally.

```
PUT    /api/v1/devices/{deviceId}/push
GET    /api/v1/devices/{deviceId}/push
DELETE /api/v1/devices/{deviceId}/push
Authorization: Bearer <token>
```

`PUT` with `{ "token": "<hex>", "key": "<base64 of 32 bytes>", "environment": "production" | "sandbox" }` registers the phone, or changes its token, key or environment. It clears the last error. `GET` returns the state. `DELETE` removes the registration. All three return:

```json
{ "registered": true, "serverReady": true, "environment": "sandbox", "lastSentAt": 1768381260000, "lastError": null }
```

- `token`: hex, 16 to 100 bytes. Upper case is accepted and stored in lower case.
- `key`: standard base64 of exactly 32 bytes. The phone creates it and keeps it in the keychain.
- Token and key never appear in responses, errors or logs.
- After `DELETE`, events still `pending` go back to `none`: the phone notifies them.
- `lastError`: the reason of the last failed send as Apple gives it (`PayloadTooLarge`, …), «HTTP 503» or «Rete: …». It is `null` after a successful send.

| Status | When |
|---|---|
| 400 | Missing field («Campo obbligatorio: token», also for `key` and `environment`), invalid token, key or environment («Parametro non valido: token»). Nothing is written. |

**When a push leaves.** A new event with delivery `notifica` or `importante`, on a registered device with the server ready, starts as `pending` with a delivery time. The delivery time is now or `deliverAfter`. If it falls inside the device quiet hours, it moves to their end (also across midnight, in the server time zone). Every minute a pass takes the events that are due and sends **one push per device**:

- one event: its title, text and page;
- more events: «N avvisi», the titles separated by «; », page `/avvisi`;
- `lockScreen` `generico`: «RingLife» and «Un nuovo avviso.» (or «N nuovi avvisi.»), page `/avvisi`.

If one of the events is `importante`, the push asks for the `time-sensitive` interruption level, otherwise `active`. An event created more than 3 days before is not sent (`failed`).

**Outcome.**

- 200: `sent`.
- 410, or 400 with `BadDeviceToken`, `Unregistered` or `DeviceTokenNotForTopic`: `failed`, and the registration is removed.
- Other 4xx: `failed`, with `lastError`.
- 5xx, 429 or a network error: retried at the next pass, at most 3 attempts per event, then `failed`.

An error never stops a data upload or the pass.

**The request.** `POST https://api.push.apple.com/3/device/<token>` (`api.sandbox.push.apple.com` for `sandbox`) over HTTP/2. Headers: `authorization: bearer <ES256 JWT signed with the .p8 key, renewed every 50 minutes>`, `apns-topic`, `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration` one day ahead. Body:

```json
{ "aps": { "alert": { "title": "RingLife", "body": "Avviso di RingLife" }, "mutable-content": 1, "thread-id": "alerts",
           "sound": "default", "interruption-level": "active" },
  "rl": { "v": 1, "c": "<base64 of nonce (12 bytes) ‖ ciphertext ‖ tag (16 bytes)>" } }
```

`c` is the JSON `{ "title", "body", "route", "ids": [...] }` encrypted with AES-256-GCM, the phone key and no associated data. This is the CryptoKit "combined" format. The notification service extension on the phone decrypts it and replaces the fallback text. See [ios-build.md](ios-build.md#push-notifications) for the app side.

## Purge old data

```
POST /api/v1/admin/purge
X-Pairing-Secret: <secret>

{ "before": 1763161200000 }
```

`before` is UTC milliseconds. The purge applies to all devices:

1. Deletes samples with `ts` before `before`.
2. Deletes sleep sessions that end before `before`, with their stages.
3. Clears all computed values: daily features, baselines, scores, metrics and plugin results.
4. Recomputes each device from its oldest remaining data (at most the last 60 days).

It does not touch diary entries, episodes, devices, plugin settings, alert rules (built-in and custom) or push registrations.

It also deletes alert events, with their push state, of all devices, on the local days that have at least one instant before `before`. The evaluation after the recomputation creates again the events that the remaining data still supports.

Response: `{ "samples": 12, "sleepSessions": 3, "recomputedDevices": 1, "alertEvents": 2 }`.

| Status | When |
|---|---|
| 400 | `before` missing or not positive |
| 401 | Missing or wrong secret |
| 404 | No pairing secret configured |

There is no button for this in the app. Run it from a terminal.

## Errors

Error responses have the body `{ "error": "<message>" }`. Messages are in Italian and never repeat the values received.

| Status | When |
|---|---|
| 400 | Invalid or malformed body, unknown metric or stage, timestamp outside 2020-01-01 to now + 1 day, overlapping stages, too many items. Nothing is written. |
| 401 | Token missing, invalid, revoked or of another device. Wrong pairing secret. |
| 404 | Registration or purge off (no pairing secret). Unknown plugin. Unknown custom alert rule. |

## Testing

- `python3 scripts/smoke_test_server.py <url> <secret>` checks a running server with synthetic data. It checks health, registration, authentication, an idempotent sleep upload and the Sleep score. It leaves a `smoke-test-...` device with an invented night in the database.
- The app has a "load test data" button in its home server settings. It sends 10 days of INVENTED data from a fixed seed (`mobile/src/app/api/demo-data.ts`): sleep, heart rate, HRV, temperature, SpO2 and steps. Then it reads the days back. This is enough to pass calibration (7 days) and see scores. Resending does not duplicate the data.
- Use both only with a test server. Their data stays in the database next to real data.
