# Plugins

A plugin is a small module that reads your daily results and diary and produces cards for the app, short insights and, optionally, Home Assistant entities. Server plugins live in `backend/src/main/java/com/ringlife/backend/plugin/`. One plugin, Breathing and heart rate, lives only in the phone app.

**RingLife is not a medical device.** Plugin results are wellness hints, not medical advice and not diagnoses. Thresholds and weights are initial guesses, not evidence. Every app screen with health hints shows a disclaimer.

The app UI is in Italian. Each plugin below gives its Italian name in parentheses. The formulas behind the plugins are in [scores.md](scores.md).

## Framework

### Contract

```java
public interface Plugin {
    String id();
    PluginManifest manifest();
    PluginResult evaluate(PluginContext ctx, LocalDate day);
}
```

- A plugin is a pure function of its context. It does not read the database, does not write, and does not call external services.
- `evaluate` never throws for missing data. It returns a result that explains what is missing, or an empty result.
- Plugins are Spring beans registered in code. There is no dynamic loading. The plugin `id` must equal the manifest `id` and must be unique.

### Manifest

`PluginManifest` describes the plugin:

| Field | Content |
|---|---|
| `id` | Stable identifier, for example `caffeine-window` |
| `name`, `description` | Text for the app, in Italian |
| `version` | Changes when the plugin logic changes, like `algo_version` for the indices. Results of different versions coexist in the database |
| `requires` | The data the plugin uses, in words, for the app |
| `config` | Configuration parameters (below) |
| `entities` | Home Assistant entities the plugin publishes (below) |
| `cadence` | `daily` or `weekly`: how often the result deserves a look. The app shows `daily` plugins as one line on the Today screen and `weekly` plugins on the Trends tab. Absent means `daily` |

A configuration parameter has a `key`, a `label`, a type and a default:

| Type | Values | Notes |
|---|---|---|
| `INT` | Integer between `min` and `max` | |
| `BOOL` | `true` or `false` | |
| `TIME` | `"HH:mm"`, 00:00 to 23:59 | |

The server completes a plugin configuration with the manifest defaults. It rejects an unknown key, a wrong type or a value out of range with HTTP 400.

The app draws each plugin's settings screen from its manifest. A new plugin with parameters needs no app code. Three parameter keys follow the app goals by default: `wakeTime` (wake time), `bedtime` (bedtime) and `sleepGoalHours` (sleep goal, in whole hours). The user can override them for one plugin only («Cambia solo qui»). The app sends the server only the values that differ from the defaults.

### Context

`PluginContext` holds everything a plugin can read:

- `deviceId`, `today`, `now` and `zone`. A plugin never reads the clock itself.
- `config`: the plugin configuration, completed with the defaults.
- `history`: daily results by local day, read-only. Each day has `scores` (0-100 indices), `metrics` (values with units, such as `sleep_debt`), `features` (such as `sleep_asleep_min`, `hrv_night`) and `deviations` (the baseline deviation of each feature, from −3 to 3).
- `diary`: caffeine and alcohol entries, headache episodes and their coded details, read-only. Plugins never see the text of free notes.
- `pressure`: the atmospheric pressure change over 24 hours, from the Home Assistant weather entity.
- `uv`: UV index readings from Home Assistant.

### Result

`PluginResult` holds:

- `cards`: what the app draws (next section).
- `insights`: short lines with a `level` (`info` or `attenzione`), a `title` and a `text`.
- `entities`: the state and attributes of each Home Assistant entity the manifest declares.
- `headline` (optional): one short summary line, `{ "value", "tone" }`, with `tone` `null` or `attenzione`. The Today screen shows it next to the plugin name instead of the cards. `null` when the plugin has nothing short to say. It reuses values the plugin already computes, so it does not change the plugin `version`.
- `alerts` (optional): alerts the plugin raises. Each one names the alert rule it feeds. The alert engine turns it into an event only when that rule is on and the plugin is on. Today only the migraine plugin uses it, with high risk (rule `migraine-risk`). Alert rules and events are described in [api.md](api.md#alerts).

A plugin never sends notifications itself. The alert engine on the server and Home Assistant automations on the entities do.

### Cards

The app draws five card types from generic JSON. It ignores types it does not know, so a new plugin needs no new app release. Card texts are already in Italian. A card with an invalid value fails at construction, so a faulty plugin cannot produce a card the app cannot draw.

| Type | Fields | Drawn as |
|---|---|---|
| `score` | `title`, `value` (0-100), `zone` (`ottimo`, `buono` or `attenzione`), `caption` | A score with its zone |
| `trend` | `title`, `points` (`null` for a day without data), `unit`, `caption` | A small series |
| `list` | `title`, `rows` of `label` and `value` | Label and value rows |
| `text` | `title` (optional), `body` | A paragraph |
| `action` | `label`, `action` | A button for an app action: `open-diary`, `log-headache` or `open-breathing`. Never a web address |

### State and storage

- State is per device: on or off, plus the chosen configuration. A plugin with no saved state is on.
- Results are stored per device, plugin, day and plugin version.
- The app shows one line per `daily` plugin on the Today screen, with its headline, and the cards of `weekly` plugins on the Trends tab («Le tue settimane»). All cards are on the plugin page. Plugins have no tab of their own. They are switched on, off and configured in Settings.

### When plugins run

The server evaluates every enabled plugin for the current day in the server time zone:

- after each upload, once the daily computation is done;
- every night, after the nightly recomputation (04:15 by default);
- after each saved hourly weather reading (pressure or UV);
- right away when a plugin is switched on or its configuration changes.

Each plugin runs in isolation. If one fails, the server logs only the error type, keeps its previous result and runs the others. Logs never contain health values.

### Home Assistant entities

A manifest can declare entities (`EntityDef`): a `key`, a `name`, an `icon` and the allowed `options`.

- Each entity becomes an `enum` sensor `sensor.ringlife_<key>` in the "RingLife" device, through MQTT discovery.
- The server publishes the discovery config even before the first evaluation. The options are stable, so automations can rely on them.
- The state and attributes come from the plugin result of the day. When the plugin is off or has no result, the state is unknown.

See [home-assistant.md](home-assistant.md) for the MQTT setup and the other entities.

### API

- `GET /api/v1/devices/{deviceId}/plugins?day=YYYY-MM-DD` lists every registered plugin with its manifest, state, complete configuration and the result of the day (today if `day` is missing).
- `PUT /api/v1/devices/{deviceId}/plugins/{pluginId}` with `enabled` and/or `config` switches a plugin on or off, or configures it.

Details in [api.md](api.md).

### Adding a plugin

1. Write a class that implements `Plugin` and annotate it with `@Component`.
2. Give it a manifest with its parameters and, if needed, its entities.
3. Write tests on synthetic days. Never use real data in tests.
4. Bump the manifest `version` whenever the logic changes.

## Server plugins

### Weekly report (`weekly-report`, «Report settimanale»)

Compares the last 7 finished days with the 7 days before. The current day is excluded because its indices are not complete.

- One `score` card for each of Recovery, Sleep and Movement: the average of the last 7 finished days.
- An average needs at least 3 days with the index. Without them, the index has no card.
- The caption compares the average with the previous 7 days, when those have at least 3 days too.
- An `info` insight when an average moves by 8 points or more.
- Parameters: none.

### Migraine (`migraine`, «Emicrania»)

A headache diary with a rule-based risk estimate for today, a 30-day summary and a report to share with a doctor. The estimate comes from simple rules with initial thresholds. It is not a diagnosis and not a clinical prediction.

**Diary.** The app records each headache episode: start, end, intensity from 1 to 10 over time, symptoms (nausea, sensitivity to light, sensitivity to sound, aura, other), location (left, right, both sides, back of the head), medication intakes and how much they helped (a lot, a little, not at all), and suspected triggers (little sleep, stress, skipped meal, weather, screens, other). The diary also records caffeine and alcohol. Plugins and reports never read free notes.

**Risk today.** The risk is a sum of points, one amount per condition, capped at 100. The weights are fixed: changing them means a new plugin version. The thresholds are parameters.

| Condition | Points | Triggers when |
|---|---|---|
| Short sleep | 20 | Asleep time of last night is below `sleepHours` |
| Low HRV | 20 | HRV deviation of last night is `−hrvDrop` or lower |
| High resting heart rate | 10 | Resting heart rate deviation is `hrRise` or higher |
| Sleep debt | 10 | Sleep debt is `debtHours` or more |
| Irregular sleep | 10 | Sleep regularity is below `regularityBelow` |
| Night temperature off your baseline | 5 | Absolute temperature deviation is `tempDeviation` or more |
| High stress yesterday | 10 | Yesterday's share of high-stress samples is `stressPercent`% or more |
| A lot of caffeine | 10 | `caffeineCups` or more caffeine entries in the last 24 hours |
| Alcohol | 10 | At least one alcohol entry in the last 24 hours |
| Pressure drop | 10 | Atmospheric pressure fell by `pressureDrop` hPa or more in 24 hours |

- A condition counts as evaluated only when its data exists.
- Caffeine and alcohol count as evaluated only if the diary has at least one caffeine or alcohol entry in the last 14 days. This separates "none" from "not logged".
- The pressure change needs a reading within 90 minutes of now and one within 90 minutes of 24 hours earlier. Pressure comes from the Home Assistant weather entity (`weather_entity` option), read every hour.
- With fewer than 3 evaluated conditions, the plugin shows no score. It says how many signals it could evaluate.
- Level: "low" below `mediumFrom`, "medium" from `mediumFrom`, "high" from `highFrom`.
- Cards: the score with how many conditions were evaluated; the triggered conditions with their points; a comparison with yesterday's risk; the 30-day summary; a button to log a headache.
- An `attenzione` insight when the level is high.

**Summary of the last 30 days.** Number of headaches, days with a headache, maximum intensity, days with medication and the average duration of closed episodes.

**Recurrences.** With at least 5 episodes in the period, the plugin compares each condition on headache days with the other days. It lists a condition only if it was evaluated on at least 3 headache days and 3 other days, triggered on at least 2 headache days, and triggered on a share of headache days at least 25 percentage points higher than on the other days. It lists at most 3, with absolute counts ("x of y against z of w"). The card says these are coincidences in your data, not proof of a cause.

**Report for a doctor.** In the app you choose 30, 90 or 180 days, see a preview and share a PDF through the phone share sheet. The server builds the PDF in memory and does not store it. It holds the summary, one row per episode and the recurrences with their caveat. It never holds free notes, names or other personal details. Endpoints: `GET /api/v1/devices/{deviceId}/reports/migraine/summary?days=90` (JSON preview) and `GET /api/v1/devices/{deviceId}/reports/migraine?days=90` (PDF).

**Home Assistant entity.** `sensor.ringlife_migraine_risk`, an `enum` sensor with options `low`, `medium` and `high`. Attributes: `score`, `evaluated` and `contributors` (a list of `id` and `points`). The state is unknown when the plugin is off or has too little data.

**Personal model (not implemented).** The plan is a personal model, tried only once at least 20 episodes are recorded: a regularized logistic regression on the features of the previous 48 hours, validated in time order, never on shuffled data. It would replace the rules only if it estimates better (AUC and Brier score) and would always show its main contributors. The app shows the progress towards 20 recorded episodes.

Parameters:

| Key | Meaning | Default | Range |
|---|---|---|---|
| `sleepHours` | Short sleep: hours below | 6 | 3-9 |
| `hrvDrop` | HRV: deviations below your baseline | 1 | 1-3 |
| `hrRise` | Resting heart rate: deviations above your baseline | 1 | 1-3 |
| `debtHours` | Sleep debt: hours | 4 | 1-12 |
| `regularityBelow` | Sleep regularity: score below | 60 | 20-90 |
| `tempDeviation` | Night temperature: deviations from your baseline | 2 | 1-3 |
| `stressPercent` | Yesterday's stress: share of high samples, percent | 40 | 20-80 |
| `caffeineCups` | Caffeine in the last 24 hours: entries | 4 | 2-10 |
| `pressureDrop` | Pressure drop in 24 hours, hPa | 6 | 2-15 |
| `mediumFrom` | Medium risk from | 30 | 10-60 |
| `highFrom` | High risk from (at least `mediumFrom` + 1) | 60 | 40-90 |

### Caffeine window (`caffeine-window`, «Finestra caffeina»)

Suggests when to start and when to stop caffeine, from your wake time and your sleep goal.

- Start: wake time + `delayMinutes`.
- Bedtime: wake time + 24 hours − sleep goal.
- Stop: bedtime − `cutoffHours`.
- Cards: start, stop and bedtime as fixed times, and a note that the values are common defaults, not evidence. Cards never say "now", because a stored result ages.
- If the diary has a caffeine entry today after the stop time, the plugin adds a card and an `info` insight.
- If the stop falls at or before the start, the plugin says the window is empty and suggests changing the parameters.
- With the defaults: start 08:30, stop 15:00, bedtime 23:00.

| Key | Meaning | Default | Range |
|---|---|---|---|
| `wakeTime` | Usual wake time | 07:00 | time |
| `sleepGoalHours` | Sleep goal, hours | 8 | 5-10 |
| `delayMinutes` | Wait after waking, minutes | 90 | 0-180 |
| `cutoffHours` | Stop before bedtime, hours | 8 | 4-12 |

### Circadian rhythm (`circadian`, «Ritmo circadiano»)

Compares the midpoint of your sleep in the last 7 nights with the midpoint you aim for, and measures how much it changes from night to night.

- Target midpoint: halfway between `bedtime` and `wakeTime`. With the defaults it is 03:00.
- Input: `sleep_midpoint_min` of the last 7 days, today included. At least 4 nights. Otherwise a card says how many nights it found.
- Shift: the mean of the circular differences from the target, in minutes. Variation: their population standard deviation.
- Cards: the latest sleep regularity score, when there is one; the average and target midpoints, shift, variation and number of nights.
- With a shift of 30 minutes or more later than the target: a card about morning light and some movement after waking to move sleep earlier.
- With a variation of 60 minutes or more: a card about keeping more regular times.
- The thresholds are initial values. The card says these are habit hints, not medical advice.

| Key | Meaning | Default | Range |
|---|---|---|---|
| `bedtime` | Usual bedtime | 23:00 | time |
| `wakeTime` | Usual wake time | 07:00 | time |

### Social jetlag (`social-jetlag`, «Jet lag sociale»)

Shows how much your sleep shifts at the weekend compared with work days, over the last 4 weeks. Formula in [scores.md](scores.md#social-jetlag-social-jetlag).

- Saturday and Sunday count as free days. A night belongs to its wake date.
- Cards: the median midpoint on work days and at the weekend, the difference, the level (low, medium, high) and the number of nights.
- A text card explains the result: stable times, a later weekend ("like changing time zone every Monday"), or an earlier weekend.
- With fewer than 2 weekend nights or 3 work-day nights, a card says how many it found.
- Parameters: none.

### Vitamin D (`vitamin-d`, «Vitamina D»)

Estimates how many minutes of sun give enough vitamin D, and after how many minutes you risk sunburn, from the UV index at home and your skin type. Formula in [scores.md](scores.md#vitamin-d-vitamin-d).

- It needs the Home Assistant weather entity (`weather_entity` option). The UV index comes from its `uv_index` attribute, or from a separate UV sensor (`uv_entity` option). Without UV readings, a card explains how to set this up.
- Cards: minutes for vitamin D and minutes to sunburn at the reference UV; yesterday's peak and today's peak so far; a table for UV 3, 5, 7 and 9 at your skin type.
- Below UV 3 the card says the skin makes little vitamin D, instead of giving minutes.
- The ring does not see the sun. These are estimates from general formulas, not measurements.

| Key | Meaning | Default | Range |
|---|---|---|---|
| `skinType` | Fitzpatrick skin type, from 1 (very fair, always burns) to 6 (very dark) | 3 | 1-6 |

## App plugin

### Training and breathing (`training`, «Allenamento e respirazione»)

This plugin lives only in the phone app. The server does not know it, and session values never reach the server. You switch it on and off in the app settings.

- The Body tab (Corpo) shows a preview of each session type with your last session, the training minutes of the week and the session history.
- **Guided breathing** («Respirazione guidata»): a full-screen session with 4 seconds in and 6 seconds out, with your live heart rate.
- **Training** («Allenamento», `/sessione/allenamento`; the old route `/sessione/battito` still works):
  - Before the start: activity type (walk, run, bike, gym, other) and an optional target zone, 1 to 5. The last choice is proposed next time.
  - During the session: large live heart rate, current zone, and the position against the target zone in words («Nella zona obiettivo», «Sopra», «Sotto»), in amber outside the zone and announced to screen readers. Active time and a chart.
  - Pause and resume (`77 02 04` and `77 03 04` to the ring, not verified on the ring yet). In pause, readings are not recorded and active time stops.
  - After «Fine» the session stays open 60 seconds to measure heart rate recovery. «Salta» closes it at once, without recovery.
  - Heart rate zones, calories and heart rate recovery are described in [scores.md](scores.md#training-calories-and-heart-rate-recovery). Zones need a birth year, calories need birth year and weight.
- **Live heart rate** comes from the ring's workout mode, about one reading per second (see [protocol.md](protocol.md)). The app resumes the stream after 3 seconds of silence, except in pause.
- After a session the app shows minimum, average and maximum heart rate, and the averages of the first and the last 30 seconds. A training also shows activity type, active time, calories and recovery.
- Session history stays on the phone: the last 50 sessions.
- A session never runs during a ring sync. The app always disconnects from the ring at the end.

Cardio age is not a plugin. The app shows it on the Trends tab, because it needs the age from the profile (see [scores.md](scores.md#cardio-age)).

## Ideas, not implemented

These ideas have a written specification but no code.

- **Home in tune.** Home Assistant automations driven by RingLife entities: open the bedroom blinds at your usual wake time or after `sensor.ringlife_sleep_end`; warmer, dimmer lights an hour before bedtime; a morning notification suggesting a light day when `sensor.ringlife_recovery_score` is below 70, never other automatic actions. These would be automations in your own Home Assistant configuration, not a server plugin. No home safety function should depend on RingLife.
- **Cycle tracking.** An estimate of the menstrual cycle from night signals: skin temperature rises a few tenths of a degree after ovulation, and resting heart rate and HRV change between phases. It would need a new diary entry for the cycle start and at least 3 recorded cycles. The finger temperature of this ring is not validated for this use. It would never be a contraceptive method or a diagnosis.

Not feasible with this ring: atrial fibrillation detection (it needs the raw PPG signal, which the ring does not expose, and it is a clinical topic), a smart alarm (the ring delivers sleep stages only after a sync), and screen time on iOS.
