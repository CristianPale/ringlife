# Scores and formulas

This page describes how RingLife turns ring data into daily indices, metrics and estimates. The server formulas live in `backend/src/main/java/com/ringlife/backend/score/` as pure functions with tests on synthetic days. The daily pipeline that feeds them lives in `backend/src/main/java/com/ringlife/backend/compute/`. A few estimates run in the phone app, because they need the profile (birth year, sex, height, weight), which never leaves the phone.

**RingLife is not a medical device.** The indices and estimates are wellness hints, not medical advice and not diagnoses. All weights and thresholds are initial values that still need tuning. They are not clinical evidence.

The app UI is in Italian. This page uses the English names. The UI labels are: Recovery (Recupero), Sleep (Sonno), Movement (Movimento), Stress (Stress) and Sleep debt (Debito di sonno). The app says "your average" («la tua media») where this page says "baseline".

## Versions

- Every formula has an `algo_version`. The current version of all server indices and metrics is `v1`.
- A formula change means a new `algo_version` and a recomputation. A formula never changes silently under the same version.
- Raw data is immutable. Indices can always be recomputed from it.
- Rows of earlier versions stay in the database. The API returns the current version only (see [api.md](api.md)).
- Plugins follow the same rule with the `version` field of their manifest (see [plugins.md](plugins.md)).

## When the server computes

- **After each upload.** The server recomputes every day from the day of the oldest uploaded sample up to today, in date order. It recomputes at most the last 60 days.
- **Every night** at 04:15 in the server time zone (`ringlife.compute.cron`, default `0 15 4 * * *`). The nightly job recomputes the last 3 days. Yesterday becomes complete and gets its Movement and Stress indices.
- **Days and time zone.** A day is a local day in the server time zone (`ringlife.zone`, default `Europe/Rome`; `timezone` in the Home Assistant app options). Timestamps are stored in UTC.
- **Sleep belongs to the wake date.** The night of a day is the longest sleep session that ends on that local day.
- **The current day** has no Movement and no Stress index. Both need a finished day.

The computation is deterministic: the same raw data gives the same features, baselines and scores. Logs never contain health values.

## Common rules for the indices

- Every component has an integer sub-score from 0 to 100.
- An index is the weighted sum of its sub-scores, rounded to an integer.
- A component without data is never invented. Its weight is spread over the components that have data: the index is `sum(weight × score) / sum(weight)` over the present components.
- If the present components weigh less than half of the total, the server does not compute the index.
- Each saved index keeps its components (`id`, `weight`, `score`; `score` is `null` when the data was missing). The app uses them to explain the score.
- Sub-score from a deviation: `clamp(75 + 12.5 × dev_oriented, 0, 100)`, rounded. A value on your baseline scores 75. `dev_oriented` is positive when the value is better than usual: HRV above baseline is better; resting heart rate, minimum heart rate and temperature above baseline are worse, so their deviation is inverted.
- Zones for an index: 85 or more is `ottimo` (very good), 70 to 84 is `buono` (good), below 70 is `attenzione` (look at it). The app shows these fixed zones in the index detail. Elsewhere the app compares each value with your own baseline instead.

## Personal baseline

The baseline is your own typical value for a metric. Every comparison in RingLife uses it.

- **Window.** The 28 days before the day. The day itself is excluded.
- **Statistics.** Median and MAD (median of absolute deviations from the median, not scaled).
- **Spread.** `spread = max(1.4826 × MAD, min_spread)`. The minimum spread prevents huge deviations when a metric is very stable or integer-valued and its MAD is 0.
- **Deviation.** `dev = (x − median) / spread`, clamped to [−3, 3]. Positive means above your baseline.
- **Minimum data.** At least 7 days with a value inside the window. Before that, the metric is "calibrating" and has no deviation.
- **First comparison.** Because the day itself is excluded, the first night with a deviation is the 8th recorded night. With 6 nights recorded, 2 more nights are missing. The app shows "Dati in calibrazione: mancano N notti" (calibrating: N nights missing). The Today screen counts nights with a Sleep index. The Recovery detail counts nights with resting heart rate or HRV.

Features with a baseline and their minimum spread:

| Feature | Meaning | Minimum spread |
|---|---|---|
| `resting_hr` | Resting heart rate of the night | 1 bpm |
| `min_hr` | Minimum heart rate of the night | 1 bpm |
| `hrv_night` | Heart rate variability (HRV) of the night | 2 ms |
| `temp_night` | Finger temperature of the night | 0.15 °C |
| `spo2_median` | Median blood oxygen saturation (SpO2) of the night | 0.5 percentage points |
| `sleep_start_min`, `sleep_end_min` | Sleep start and end | 15 min |
| `sleep_deep_min`, `sleep_rem_min`, `sleep_light_min`, `sleep_awake_min` | Minutes per sleep stage | 5 min |
| Each 0-100 index | Saved daily scores | 3 points |

All minimum spreads are initial values.

## Night features

The ring firmware classifies the sleep stages (deep, light, REM, awake). RingLife does not stage sleep itself. The server reduces each night to these features:

| Feature | How |
|---|---|
| `sleep_asleep_min` | Deep + light + REM minutes |
| `sleep_in_bed_min` | Asleep minutes + awake minutes |
| `sleep_awakenings` | Number of awake stages after the first sleep stage |
| `sleep_midpoint_min` | Midpoint between session start and end, in minutes after local midnight of the wake date. A time before midnight is negative: 23:40 is −20 |
| `sleep_start_min`, `sleep_end_min` | Session start and end, same coordinates |
| `resting_hr` | Median of the heart rate samples during the night. Needs at least 10 samples |
| `min_hr` | 5th percentile (nearest rank) of the same samples. Needs at least 10 samples |
| `hrv_night` | Median of the HRV samples during the night. Needs at least 3 samples |
| `temp_night` | Median of the temperature samples during the night. Needs at least 3 samples |
| `spo2_median`, `spo2_min` | Median and minimum of the SpO2 samples during the night. Needs at least 10 samples |

## Sleep (`sleep`)

The Sleep index rates the night that ends on the day. It needs at least one minute of sleep.

| Component | Id | Weight | Sub-score |
|---|---|---|---|
| Duration | `sleep-duration` | 30% | `min(asleep / goal, 1) × 100`. The goal defaults to 480 minutes (`ringlife.goals.sleep-minutes`, `sleep_goal_minutes` in the Home Assistant app options) |
| Efficiency | `sleep-efficiency` | 15% | `asleep / in bed`. 75% scores 0, 95% scores 100, linear in between |
| Deep sleep | `sleep-deep` | 15% | Share of deep sleep in the asleep time. 15% or more scores 100, linear from 0 |
| REM sleep | `sleep-rem` | 15% | Share of REM sleep in the asleep time. 20% or more scores 100, linear from 0 |
| Awakenings | `sleep-awakenings` | 10% | `100 − 10 × awakenings − 0.5 × awake minutes`, clamped to 0-100 |
| Regularity | `sleep-regularity` | 10% | The sleep regularity score (next section) |
| Minimum heart rate | `sleep-min-hr` | 5% | Deviation sub-score of `min_hr`, inverted: lower than usual is better |

## Sleep regularity (`sleep_regularity`)

A separate 0-100 score. The Sleep index uses it as a component, and the app shows it on the Sleep tab.

- Input: `sleep_midpoint_min` of the last 7 nights, the wake date included. At least 5 nights.
- `sd` is the population standard deviation of the midpoints, in minutes.
- `gap` is the absolute difference between the mean midpoint of weekday nights and the mean midpoint of weekend nights. A weekend night is a night that ends on Saturday or Sunday.
- Score: `0.7 × 100 × (1 − min(sd / 90, 1)) + 0.3 × 100 × (1 − min(gap / 120, 1))`, rounded.
- With fewer than 2 weekend nights, only the first term counts: `100 × (1 − min(sd / 90, 1))`.
- The saved row keeps `variationMin` (the rounded `sd`) and `weekendGapMin` (the rounded `gap`, or `null`).

## Movement (`movement`)

The Movement index rates a whole finished day. The current day has none. It needs step data for the day.

Steps are summed per local hour. Each step sample is the number of steps in the interval that ends at its timestamp.

| Component | Id | Weight | Sub-score |
|---|---|---|---|
| Steps | `move-steps` | 40% | `min(steps / goal, 1) × 100`. The goal defaults to 8,000 steps (`ringlife.goals.steps`, `steps_goal` in the Home Assistant app options) |
| Active hours | `move-active-hours` | 30% | Hours with at least 250 steps. 10 hours score 100, linear from 0 |
| Effort minutes | `move-hr-minutes` | 20% | Minutes with heart rate at or above 100 bpm. 30 minutes score 100, linear from 0 |
| Long idle stretches | `move-sedentary` | 10% | `100 − 12.5 × idle hours`, minimum 0 |

- **Effort minutes.** The server does not know your age, so it uses a fixed threshold (`ringlife.compute.hr-zone-threshold`, default 100 bpm). Each heart rate sample at or above the threshold counts as 5 minutes (`ringlife.compute.hr-sample-minutes`, default 5). This assumes the ring measures heart rate every 5 minutes.
- **Idle hours.** An idle stretch is at least 2 consecutive hours with fewer than 250 steps each, between 07:00 and 23:00. Idle hours are the hours inside such stretches.
- The targets of 10 active hours and 30 effort minutes are initial values.

## Stress (`stress`)

The Stress index rates a whole finished day. **A higher score means a calmer day**, like the other indices. The current day has none, so Recovery uses yesterday's Stress index.

The input is the ring's STRESS samples. They use the ring's own scale, where a higher value means more stress (see [protocol.md](protocol.md)). The index counts samples, not minutes, because the measurement interval can change.

- **Daytime** is 07:00 to 23:00, local time. **Evening** is 19:00 to 23:00.
- The index needs at least 8 daytime samples. Otherwise there is no index.

| Component | Id | Weight | Sub-score |
|---|---|---|---|
| Load | `stress-load` | 70% | `s` is the share of daytime samples with value 60 or more. `100 × (1 − min(s / 0.5, 1))`: when half of the daytime samples are high, the score is 0 |
| Evening recovery | `stress-evening` | 30% | `drop = median(07:00–19:00) − median(19:00–23:00)`. `clamp(50 + 2.5 × drop, 0, 100)`: a drop of 20 points scores 100, no change scores 50, a rise of 20 points scores 0 |

- Evening recovery needs at least 3 samples in each of the two windows. Without them the component is missing and load carries the whole index.
- The day features keep the numbers behind the score: `stress_samples`, `stress_high_share`, `stress_day_median`, `stress_evening_median`.
- The threshold 60, the weights and the 0.5 share are initial values to tune on real data.

## Recovery (`recovery`)

The Recovery index says how recovered you are this morning, against your own baseline.

| Component | Id | Weight | Sub-score |
|---|---|---|---|
| HRV | `hrv` | 35% | Deviation sub-score of `hrv_night`. Higher than usual is better |
| Resting heart rate | `hr-riposo` | 25% | Deviation sub-score of `resting_hr`, inverted |
| Temperature | `temperatura` | 15% | Deviation sub-score of `temp_night`, inverted |
| Sleep | `sonno` | 15% | The Sleep index of the night, as is |
| Stress | `stress` | 10% | Yesterday's Stress index, as is |

The component ids are the identifiers stored in the database and returned by the API.

The app adds two readings on top of the score:

- **What weighs today.** For each component, `weight × max(0, 75 − score)`: the Recovery points lost against your usual. The app shows at most the two largest, and only those worth at least 1 point.
- **Verdict.** 85 or more: «Puoi spingere» (you can push). 70 to 84: «Giornata nella norma» (a normal day). Below 70: «Vai piano oggi» (take it easy today). These are wellness hints, not medical advice.

## Sleep debt (`sleep_debt`)

Sleep debt is a metric in hours, not a 0-100 index.

- Input: asleep minutes of the last 7 days, the day included, and the sleep goal.
- Each day adds `max(0, goal − asleep)`. One extra hour of sleep does not pay back another night.
- Linear weights favour recent days: from 1/4 for the oldest day to 7/4 for the most recent. The weights average 1, so a one-hour deficit every day gives 7 hours of debt.
- Days without data do not count. A deficit is never invented. With no data in all 7 days, there is no value.

## Temperature deviation (`temp_deviation`)

The ring measures skin temperature at the finger. Its absolute value is not meaningful, so RingLife only uses it relative to your baseline.

- The metric is `temp_night − baseline median`, in °C, rounded to 0.01.
- Recovery, strain signals and the migraine plugin use the normalized deviation `dev` instead.
- It is an estimate from the finger, not a thermometer reading.

## Strain signals (`strain_level`)

Strain signals flag a night where three signals move the wrong way together. They do not change the Recovery index.

- Signals, with the raw deviation of the night that ends on the day: resting heart rate `dev ≥ +1`, HRV `dev ≤ −1`, temperature `dev ≥ +1`.
- Three signals: level "high". Two signals: level "attention". Fewer than two: no level.
- All three signals need a valid baseline. Otherwise the server saves no row and the app shows "calibrating".
- The metric value is the level (0 none, 1 attention, 2 high). Its detail holds `level` and `count`.
- The app checks the phone diary for a likely cause. If you logged alcohol between 18:00 of the previous day and 05:00 of the wake date, the app names it as a possible cause and caps the level at "attention". A late meal has the same effect in the code, but the diary does not record meals yet. The server metric ignores diary causes.
- The app text is «Riposo consigliato oggi» (rest recommended today). It is never a diagnosis.

## Night breathing (`spo2_night`)

Night breathing follows the trend of your blood oxygen saturation (SpO2) during sleep. The app shows it on the Sleep tab.

- Input: SpO2 samples between the start and the end of the night. At least 10 samples. Otherwise the status is "insufficient data".
- For the night: median and minimum.
- Deviation of tonight's median from your baseline: median and MAD of the medians of the 28 previous nights, tonight excluded, at least 7 nights. The minimum spread is 0.5 percentage points, because the readings are integers and a stable person can have MAD 0.
- Status "to watch" when the deviation is −2 or lower for 3 consecutive nights with SpO2 data. Each night's deviation uses only the nights before it.
- There is no absolute SpO2 threshold.
- The metric value is the median, in %. Its detail holds `status` (`insufficient`, `calibrating`, `ok`, `watch`), `count`, `streak`, `min` and `deviation`.
- The app text talks about a trend and suggests seeing a doctor if it persists. It never suggests a diagnosis.

## Personal references in the API

The day endpoint returns references that compare each value with your baseline (see [api.md](api.md)). They add no new formula and no new `algo_version`.

- `references`: for each feature with a baseline, `median`, `deviation` (the `dev` above, rounded to 0.01) and `spread`.
- `scoreReferences`: the same triple for each 0-100 index of the day. The baseline is the median and MAD of the saved scores of the 28 previous days, the day excluded, at least 7 days, minimum spread 3 points. The server computes it when you read it and does not store it.
- Your usual range is `median ± 1.5 × spread`. The app draws each value against this range, with marks at ±1.5.
- Direction: higher is better for the indices, HRV, deep sleep and REM sleep. Lower is better for heart rate and awake time. Light sleep and temperature have no better direction, so the app never calls them "worse".

## Computed in the app

These estimates need the profile, which stays on the phone. They have no `algo_version` on the server.

### Cardio age

The app shows cardio age on the Trends tab (Andamento).

- **Estimated maximum heart rate** (Tanaka): `208 − 0.7 × age`, rounded. The age comes from the birth year.
- **Resting heart rate**: median of `resting_hr` over the last 14 nights that have it. At least 5 nights. This is the night median, which is lower than an awake resting heart rate, so the estimate tends to be optimistic.
- **Estimated VO2max** (Uth and colleagues): `15.3 × maximum heart rate / resting heart rate`, in ml/kg/min.
- **Cardio age**: the age at which the population median VO2max equals yours. The medians (50th percentile) come from the FRIEND registry (Kaminsky and others, Mayo Clinic Proceedings 2015, table 3, treadmill), placed at the centre of each decade from 25 to 75 years:

| Age | 25 | 35 | 45 | 55 | 65 | 75 |
|---|---|---|---|---|---|---|
| Men | 48.0 | 42.4 | 37.8 | 32.6 | 28.2 | 24.4 |
| Women | 37.6 | 30.2 | 26.7 | 23.4 | 20.0 | 18.3 |

- Sex not given: the average of the two curves.
- Linear interpolation between decades. Outside the table, the line extends with the slope of the nearest segment.
- The result is clamped between 20 and 80 years. The app then says "20 or younger" or "80 or older".
- Without a birth year, or with fewer than 5 nights, there is no estimate.

### Heart rate zones

The app uses zones during training sessions (see the Training and breathing plugin in [plugins.md](plugins.md)).

- Zones are a share of the estimated maximum heart rate: zone 1 from 50%, zone 2 from 60%, zone 3 from 70%, zone 4 from 80%, zone 5 from 90%. Zone 5 also covers values above the maximum. Below 50% is "below zone 1" and does not count as training.
- Time in zones: each reading lasts until the next one, at most 5 seconds. The last reading lasts 1 second.
- Without a birth year there are no zones.
- The server Movement index does not use these zones. It uses the fixed threshold in bpm described above.

### Training: calories and heart rate recovery

Computed in the app during a training session, because the live data and the profile stay on the phone. Sessions never reach the server.

- **Calories**: Keytel and colleagues, Journal of Sports Sciences 23(3), 2005, model without VO2max, in kJ per minute.
  - Men: `−55.0969 + 0.6309 × heart_rate + 0.1988 × weight_kg + 0.2017 × age`.
  - Women: `−20.4022 + 0.4472 × heart_rate − 0.1263 × weight_kg + 0.074 × age`.
  - Sex not given: the average of the two.
  - A negative minute counts as 0. Each reading lasts until the next one, at most 5 seconds (a pause does not count). The last reading lasts 1 second.
  - kcal = kJ / 4.184, rounded.
  - Needs birth year and weight. Without them, no calories.
  - The model was built for submaximal effort. Below 90 bpm it is less accurate. The coefficients were checked against a secondary reproduction, not the original article.
- **Heart rate recovery**: after «Fine» the ring measures for 60 more seconds.
  - End heart rate: the average of the readings in the last 10 seconds of activity.
  - Heart rate after one minute: the average of the readings between 50 and 60 seconds after the end.
  - Recovery = end − after, in beats. Without readings between 50 and 60 seconds, or with «Salta», there is no recovery.
  - There is no threshold for everyone. Compare with your own sessions.
- **Active time**: from the start to «Fine», minus the pauses.

### Daily calories

The app shows a calorie estimate in the Movement detail. The server does not compute calories.

- Resting energy (Mifflin-St Jeor): `10 × weight_kg + 6.25 × height_cm − 5 × age`, plus 5 for men, minus 161 for women. Sex not given: the average of the two formulas.
- Activity: `steps × weight_kg × 0.0005` kcal.
- Digestion: 10% of resting energy plus activity.
- Without birth year, height and weight, the app estimates nothing. It never fills in average values.
- The activity coefficient and the digestion share are initial values.

## Plugin formulas

These plugins run on the server. Their cards, parameters and versions are described in [plugins.md](plugins.md).

### Social jetlag (`social-jetlag`)

- Input: `sleep_midpoint_min` of the last 28 days, today included.
- Free days: nights that end on Saturday or Sunday. Work days: nights that end Monday to Friday.
- `jetlag = median(free) − median(work)`, taken as the shorter difference on the 24-hour circle. Positive means later at the weekend.
- At least 2 free nights and 3 work nights.
- Level by absolute value: below 60 minutes "low", from 60 "medium", from 120 "high". Initial thresholds.

### Vitamin D (`vitamin-d`)

- Input: the UV index from Home Assistant, sampled every hour, and the Fitzpatrick skin type (plugin parameter, 1 to 6).
- Reference UV: the higher of yesterday's peak and today's peak so far. In the morning today's UV is still low, so yesterday says more.
- One UV index point is 0.025 W/m² of erythemal irradiance, that is 1.5 J/m² per minute.
- Minutes to the minimal erythemal dose (sunburn): `MED / (1.5 × UV)`.
- Minimal erythemal dose by skin type, in J/m²: 200, 250, 300, 450, 600, 1000 (types 1 to 6). Typical initial values, not measurements.
- Minutes for vitamin D, with face and arms uncovered around midday: a quarter of the minutes to sunburn. An initial rule of thumb.
- Below UV 3 the skin makes little vitamin D. The plugin says so instead of giving minutes.
- Rounding: to the minute below 10 minutes (at least 1), to 5 minutes from 10 minutes up.
- The ring does not see the sun. These are estimates from general formulas, not measurements.
