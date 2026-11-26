package com.ringlife.backend.plugin;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.stereotype.Component;

import com.ringlife.backend.compute.Features;
import com.ringlife.backend.compute.History.DayResults;
import com.ringlife.backend.diary.DiaryLog;
import com.ringlife.backend.plugin.PluginManifest.EntityDef;
import com.ringlife.backend.plugin.PluginManifest.Field;

/**
 * Emicrania v1 (ADR 0014): rischio 0-100 come somma di punti per condizione. I pesi sono fissi (cambiarli e'
 * cambiare il modello: nuova versione), le soglie si configurano. Non e' una diagnosi ne' una previsione clinica.
 */
@Component
class MigrainePlugin implements Plugin {

    static final String ID = "migraine";
    static final String ENTITY = "migraine_risk";
    /** The built-in alert rule this plugin feeds (ADR 0045). */
    static final String ALERT_RULE = "migraine-risk";

    /** Meno condizioni valutabili di cosi' e' un numero senza base: non si mostra un punteggio. */
    static final int MIN_EVALUATED = 3;

    /** Finestra del riepilogo, in giorni (ADR 0015). */
    static final int REPORT_DAYS = 30;

    /** Sotto questo numero di cefalee non si cercano ricorrenze: a 3-4 episodi si trova sempre qualcosa. */
    static final int MIN_EPISODES = 5;

    /** Giorni con cefalea, e senza, in cui una condizione deve essere valutabile per confrontarla. */
    static final int MIN_DAYS_TO_COMPARE = 3;

    /** Di quanto la quota dei giorni con cefalea deve superare quella degli altri giorni. */
    static final double MIN_GAP = 0.25;

    /** Giorni con cefalea in cui la condizione deve essere scattata. */
    static final int MIN_TRIGGERED = 2;

    static final int MAX_RECURRENCES = 3;

    /** Headline when too few conditions can be evaluated for a score. */
    static final String NO_ESTIMATE = "Dati insufficienti";

    /** Una condizione del modello: peso fisso, valutata (ha i dati) e scattata. */
    record Condition(String id, String label, int points, boolean evaluated, boolean triggered) {}

    /** Il rischio di un giorno e come ci si e' arrivati. */
    record Risk(int score, int evaluated, List<Condition> conditions) {
        boolean pressureEvaluated() {
            return conditions.stream().anyMatch(c -> "pressure_drop".equals(c.id()) && c.evaluated());
        }

        List<Condition> contributors() {
            return conditions.stream().filter(Condition::triggered).sorted((a, b) -> b.points() - a.points()).toList();
        }
    }

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Emicrania",
            "Stima del rischio di cefalea di oggi da sonno, battito, variabilità cardiaca, stress, diario e pressione atmosferica. Soglie iniziali, non evidenze.",
            "3",
            List.of("Indici giornalieri", "Diario (caffeina, alcol, cefalee)", "Pressione atmosferica (meteo di Home Assistant, facoltativa)"),
            List.of(
                    Field.integer("sleepHours", "Sonno corto: ore dormite sotto", 6, 3, 9),
                    Field.integer("hrvDrop", "Variabilità cardiaca: scostamenti sotto la tua media", 1, 1, 3),
                    Field.integer("hrRise", "Battito a riposo: scostamenti sopra la tua media", 1, 1, 3),
                    Field.integer("debtHours", "Debito di sonno: ore", 4, 1, 12),
                    Field.integer("regularityBelow", "Regolarità del sonno: indice sotto", 60, 20, 90),
                    Field.integer("tempDeviation", "Temperatura notturna: scostamenti dalla tua media", 2, 1, 3),
                    Field.integer("stressPercent", "Stress di ieri: quota di tempo alto, percento", 40, 20, 80),
                    Field.integer("caffeineCups", "Caffeina nelle ultime 24 ore: voci", 4, 2, 10),
                    Field.integer("pressureDrop", "Pressione: calo nelle 24 ore, hPa", 6, 2, 15),
                    Field.integer("mediumFrom", "Rischio medio da", 30, 10, 60),
                    Field.integer("highFrom", "Rischio alto da", 60, 40, 90)),
            List.of(new EntityDef(ENTITY, "Rischio emicrania", "mdi:head-alert", List.of("low", "medium", "high"))),
            PluginManifest.DAILY);

    @Override
    public String id() {
        return ID;
    }

    @Override
    public PluginManifest manifest() {
        return manifest;
    }

    @Override
    public PluginResult evaluate(PluginContext context, LocalDate day) {
        Risk today = risk(context, day, context.now());
        Optional<Risk> yesterday = Optional.of(risk(context, day.minusDays(1), day.atStartOfDay(context.zone()).toInstant()))
                .filter(r -> r.evaluated() >= MIN_EVALUATED);

        if (today.evaluated() < MIN_EVALUATED) {
            List<Card> cards = List.of(
                    new Card.Text(
                            "Rischio emicrania",
                            "Non ci sono ancora abbastanza dati per una stima: servono almeno " + MIN_EVALUATED
                                    + " segnali tra sonno, battito, variabilità cardiaca, stress, diario e pressione. Valutati oggi: "
                                    + today.evaluated() + " su " + today.conditions().size() + "."));
            List<Card> thin = new ArrayList<>(cards);
            thin.addAll(report(context, day));
            thin.add(new Card.Action("Registra una cefalea", "log-headache"));
            return new PluginResult(
                    thin, List.of(), List.of(new PluginResult.EntityState(ENTITY, null, Map.of())), PluginResult.Headline.of(NO_ESTIMATE));
        }

        int medium = context.intConfig("mediumFrom");
        int high = Math.max(context.intConfig("highFrom"), medium + 1);
        String level = level(today.score(), medium, high);
        List<Condition> contributors = today.contributors();

        List<Card> cards = new ArrayList<>();
        cards.add(new Card.Score(
                "Rischio emicrania",
                today.score(),
                zone(level),
                "Valutate " + today.evaluated() + " condizioni su " + today.conditions().size()
                        + ". Una stima da regole con soglie iniziali, non una diagnosi."
                        + (today.pressureEvaluated()
                                ? ""
                                : " La pressione atmosferica non è ancora disponibile: serve l'entità meteo di Home Assistant e almeno un giorno di letture.")));
        if (!contributors.isEmpty()) {
            cards.add(new Card.ListCard(
                    "Cosa pesa",
                    contributors.stream().map(c -> new Card.Row(c.label(), "+" + c.points())).toList()));
        }
        yesterday.ifPresent(before -> cards.add(new Card.Text(null, comparison(today.score(), before.score()))));
        cards.addAll(report(context, day));
        cards.add(new Card.Action("Registra una cefalea", "log-headache"));

        List<PluginResult.Insight> insights = new ArrayList<>();
        if ("high".equals(level)) {
            insights.add(new PluginResult.Insight(
                    "attenzione",
                    "Rischio emicrania alto",
                    contributors.isEmpty()
                            ? "Il rischio di oggi è alto."
                            : "Pesano: " + String.join(", ", contributors.stream().map(c -> c.label().toLowerCase(Locale.ROOT)).toList()) + "."));
        }

        List<Map<String, Object>> contributorAttributes = contributors.stream()
                .map(c -> Map.<String, Object>of("id", c.id(), "points", c.points()))
                .toList();
        Map<String, Object> attributes = new LinkedHashMap<>();
        attributes.put("score", today.score());
        attributes.put("evaluated", today.evaluated());
        attributes.put("contributors", contributorAttributes);
        return new PluginResult(cards, insights, List.of(new PluginResult.EntityState(ENTITY, level, attributes)), headline(level))
                .withAlerts("high".equals(level) ? List.of(alert(today.score(), contributors)) : List.of());
    }

    /**
     * The alert for a high risk (ADR 0045, rule {@value #ALERT_RULE}): the score, what weighs most and a habit
     * suggestion. Same values as the cards, no new formula; never a diagnosis.
     */
    static PluginResult.Alert alert(int score, List<Condition> contributors) {
        List<String> labels = contributors.stream().limit(3).map(c -> c.label().toLowerCase(Locale.ROOT)).toList();
        String weighs = labels.isEmpty() ? "" : " Pesano " + joined(labels) + ".";
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("score", score);
        values.put("contributors", contributors.stream().map(Condition::id).toList());
        return new PluginResult.Alert(
                ALERT_RULE,
                "Rischio emicrania alto oggi",
                "Stima " + score + " su 100." + weighs + " Pause, acqua e pasti regolari possono aiutare.",
                values);
    }

    /** «a», «a e b», «a, b e c». */
    private static String joined(List<String> items) {
        if (items.size() == 1) {
            return items.get(0);
        }
        return String.join(", ", items.subList(0, items.size() - 1)) + " e " + items.get(items.size() - 1);
    }

    /** "Rischio basso", "Rischio medio" or "Rischio alto"; medium and high ask for a look. */
    static PluginResult.Headline headline(String level) {
        return switch (level) {
            case "high" -> PluginResult.Headline.attention("Rischio alto");
            case "medium" -> PluginResult.Headline.attention("Rischio medio");
            default -> PluginResult.Headline.of("Rischio basso");
        };
    }

    /** Il rischio di un giorno: la notte che finisce quel giorno, ieri e il diario delle 24 ore fino a `until`. */
    Risk risk(PluginContext context, LocalDate day, Instant until) {
        return risk(context, day, until, context.history().days(context.deviceId(), day.minusDays(1), day), null);
    }

    /**
     * Come sopra, con i risultati gia' letti (`days` contiene almeno ieri e il giorno) e, se si hanno, le bevande gia'
     * lette (`preloadedDrinks`, da filtrare sulla finestra): serve a valutare molti giorni senza rileggere tutto.
     */
    private Risk risk(PluginContext context, LocalDate day, Instant until, List<DayResults> days, List<DiaryLog.Drink> preloadedDrinks) {
        DayResults thisDay = days.stream().filter(d -> d.day().equals(day)).findFirst().orElse(null);
        DayResults before = days.stream().filter(d -> d.day().equals(day.minusDays(1))).findFirst().orElse(null);

        Instant windowEnd = until;
        Instant windowStart = until.minus(Duration.ofHours(24));
        boolean logsDrinks = context.diary().hasDrinkEntriesSince(context.deviceId(), until.minus(Duration.ofDays(14)).toEpochMilli());
        List<DiaryLog.Drink> drinks;
        if (!logsDrinks) {
            drinks = List.of();
        } else if (preloadedDrinks != null) {
            drinks = preloadedDrinks.stream()
                    .filter(d -> d.ts() >= windowStart.toEpochMilli() && d.ts() < windowEnd.toEpochMilli())
                    .toList();
        } else {
            drinks = context.diary().drinks(context.deviceId(), windowStart.toEpochMilli(), windowEnd.toEpochMilli());
        }

        List<Condition> conditions = new ArrayList<>();
        Double asleep = feature(thisDay, Features.ASLEEP_MIN);
        conditions.add(new Condition(
                "short_sleep", "Sonno corto", 20, asleep != null, asleep != null && asleep < context.intConfig("sleepHours") * 60.0));

        Double hrv = deviation(thisDay, Features.HRV_NIGHT);
        conditions.add(new Condition(
                "low_hrv", "Variabilità cardiaca bassa", 20, hrv != null, hrv != null && hrv <= -context.intConfig("hrvDrop")));

        Double rhr = deviation(thisDay, Features.RESTING_HR);
        conditions.add(new Condition(
                "high_resting_hr", "Battito a riposo alto", 10, rhr != null, rhr != null && rhr >= context.intConfig("hrRise")));

        Double debt = thisDay == null ? null : thisDay.metrics().get("sleep_debt");
        conditions.add(new Condition(
                "sleep_debt", "Debito di sonno", 10, debt != null, debt != null && debt >= context.intConfig("debtHours")));

        Integer regularity = thisDay == null ? null : thisDay.scores().get("sleep_regularity");
        conditions.add(new Condition(
                "irregular_sleep", "Sonno irregolare", 10, regularity != null,
                regularity != null && regularity < context.intConfig("regularityBelow")));

        Double temp = deviation(thisDay, Features.TEMP_NIGHT);
        conditions.add(new Condition(
                "temperature", "Temperatura notturna fuori dalla tua media", 5, temp != null,
                temp != null && Math.abs(temp) >= context.intConfig("tempDeviation")));

        Double stress = feature(before, Features.STRESS_HIGH_SHARE);
        conditions.add(new Condition(
                "stress", "Stress alto ieri", 10, stress != null, stress != null && stress >= context.intConfig("stressPercent") / 100.0));

        long caffeine = drinks.stream().filter(d -> "caffeine".equals(d.kind())).count();
        conditions.add(new Condition(
                "caffeine", "Molta caffeina", 10, logsDrinks, logsDrinks && caffeine >= context.intConfig("caffeineCups")));

        long alcohol = drinks.stream().filter(d -> "alcohol".equals(d.kind())).count();
        conditions.add(new Condition("alcohol", "Alcol", 10, logsDrinks, logsDrinks && alcohol >= 1));

        java.util.OptionalDouble pressureChange = context.pressure().change24h(until);
        conditions.add(new Condition(
                "pressure_drop", "Calo di pressione", 10, pressureChange.isPresent(),
                pressureChange.isPresent() && pressureChange.getAsDouble() <= -context.intConfig("pressureDrop")));

        int score = Math.min(100, conditions.stream().filter(Condition::triggered).mapToInt(Condition::points).sum());
        int evaluated = (int) conditions.stream().filter(Condition::evaluated).count();
        return new Risk(score, evaluated, conditions);
    }

    /** Il riepilogo delle cefalee degli ultimi 30 giorni, con le ricorrenze se ci sono abbastanza episodi (ADR 0015). */
    List<Card> report(PluginContext context, LocalDate day) {
        return cards(reportData(context, day, REPORT_DAYS));
    }

    /** Le card del riepilogo: stessi numeri del report al medico, che li prende da {@link #reportData}. */
    private static List<Card> cards(MigraineReport.Data data) {
        String title = "Cefalee, ultimi " + data.days() + " giorni";
        if (data.summary() == null) {
            return List.of(new Card.Text(title, "Nessuna cefalea registrata negli ultimi " + data.days() + " giorni."));
        }
        MigraineReport.Summary summary = data.summary();
        List<Card.Row> rows = new ArrayList<>();
        rows.add(new Card.Row("Cefalee", String.valueOf(summary.episodes())));
        rows.add(new Card.Row("Giorni con cefalea", String.valueOf(summary.headacheDays())));
        rows.add(new Card.Row("Intensità massima", summary.peakMax() + " su 10"));
        rows.add(new Card.Row("Giorni con farmaci registrati", String.valueOf(summary.medicationDays())));
        if (summary.averageDurationMin() != null) {
            long average = summary.averageDurationMin();
            rows.add(new Card.Row("Durata media", (average / 60) + " h " + String.format(Locale.ROOT, "%02d", average % 60) + " min"));
        }
        List<Card> cards = new ArrayList<>();
        cards.add(new Card.ListCard(title, rows));

        if (summary.episodes() < MIN_EPISODES) {
            cards.add(new Card.Text(null, "Con meno di " + MIN_EPISODES + " cefalee non si cercano ricorrenze: ne servono di più."));
            return cards;
        }
        if (!data.recurrences().isEmpty()) {
            cards.add(new Card.ListCard(
                    "Cosa ricorre nei giorni con cefalea",
                    data.recurrences().stream().map(r -> new Card.Row(r.label(), r.describe())).toList()));
            cards.add(new Card.Text(
                    null,
                    "Sono coincidenze osservate nei tuoi dati, non una prova che la causa sia questa. Il confronto è tra i giorni con cefalea e gli altri."));
        }
        return cards;
    }

    /**
     * I dati del riepilogo sugli ultimi `days` giorni fino a `day`, per le card e per il report al medico (ADR 0015, 0019):
     * un solo calcolo, quindi gli stessi numeri e gli stessi criteri. Le note libere non entrano mai.
     */
    MigraineReport.Data reportData(PluginContext context, LocalDate day, int days) {
        LocalDate from = day.minusDays(days - 1L);
        ZoneId zone = context.zone();
        long fromMs = from.atStartOfDay(zone).toInstant().toEpochMilli();
        long toMs = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        List<DiaryLog.Headache> episodes = context.diary().headaches(context.deviceId(), fromMs, toMs);
        if (episodes.isEmpty()) {
            return new MigraineReport.Data(from, day, days, null, List.of(), List.of());
        }
        Map<Long, DiaryLog.HeadacheDetails> details = new LinkedHashMap<>();
        for (DiaryLog.HeadacheDetails d : context.diary().headacheDetails(context.deviceId(), fromMs, toMs)) {
            details.put(d.start(), d);
        }

        Set<LocalDate> headacheDays = new TreeSet<>();
        Set<LocalDate> medicationDays = new TreeSet<>();
        int peak = 0;
        long peakSum = 0;
        int intakes = 0;
        long closedMinutes = 0;
        int closed = 0;
        List<MigraineReport.EpisodeRow> rows = new ArrayList<>();
        for (DiaryLog.Headache episode : episodes) {
            LocalDate startDay = Instant.ofEpochMilli(episode.start()).atZone(zone).toLocalDate();
            headacheDays.add(startDay);
            if (episode.medicationCount() > 0) {
                medicationDays.add(startDay);
            }
            intakes += episode.medicationCount();
            peak = Math.max(peak, episode.peak());
            peakSum += episode.peak();
            if (episode.end() != null) {
                closedMinutes += (episode.end() - episode.start()) / 60_000;
                closed++;
            }
            DiaryLog.HeadacheDetails extra = details.get(episode.start());
            rows.add(new MigraineReport.EpisodeRow(
                    episode.start(),
                    episode.end(),
                    episode.peak(),
                    extra == null ? List.of() : extra.symptoms(),
                    extra == null ? null : extra.location(),
                    episode.medicationCount(),
                    extra == null ? null : extra.medicationHelp(),
                    extra == null ? List.of() : extra.causes()));
        }
        MigraineReport.Summary summary = new MigraineReport.Summary(
                episodes.size(),
                headacheDays.size(),
                peak,
                (double) peakSum / episodes.size(),
                medicationDays.size(),
                intakes,
                closed > 0 ? closedMinutes / closed : null);
        List<MigraineReport.Recurrence> recurrences =
                episodes.size() < MIN_EPISODES ? List.of() : recurrences(context, from, day, headacheDays);
        return new MigraineReport.Data(from, day, days, summary, rows, recurrences);
    }

    /** Le condizioni scattate nei giorni con cefalea molto piu' spesso che negli altri (ADR 0015). */
    private List<MigraineReport.Recurrence> recurrences(PluginContext context, LocalDate from, LocalDate day, Set<LocalDate> headacheDays) {
        ZoneId zone = context.zone();
        List<DayResults> history = context.history().days(context.deviceId(), from.minusDays(1), day);
        long drinksFrom = from.atStartOfDay(zone).toInstant().minus(Duration.ofHours(24)).toEpochMilli();
        List<DiaryLog.Drink> drinks = context.diary().drinks(context.deviceId(), drinksFrom, context.now().toEpochMilli());

        Map<String, int[]> counts = new LinkedHashMap<>();
        Map<String, String> labels = new LinkedHashMap<>();
        for (LocalDate date = from; !date.isAfter(day); date = date.plusDays(1)) {
            Instant until = date.equals(day) ? context.now() : date.plusDays(1).atStartOfDay(zone).toInstant();
            Risk risk = risk(context, date, until, history, drinks);
            boolean headache = headacheDays.contains(date);
            for (Condition condition : risk.conditions()) {
                labels.put(condition.id(), condition.label());
                if (!condition.evaluated()) {
                    continue;
                }
                // [giorni con cefalea valutati, scattati, altri giorni valutati, scattati]
                int[] c = counts.computeIfAbsent(condition.id(), k -> new int[4]);
                int offset = headache ? 0 : 2;
                c[offset]++;
                if (condition.triggered()) {
                    c[offset + 1]++;
                }
            }
        }
        record Found(MigraineReport.Recurrence recurrence, double gap) {}
        List<Found> found = new ArrayList<>();
        counts.forEach((id, c) -> {
            if (c[0] < MIN_DAYS_TO_COMPARE || c[2] < MIN_DAYS_TO_COMPARE || c[1] < MIN_TRIGGERED) {
                return;
            }
            double gap = (double) c[1] / c[0] - (double) c[3] / c[2];
            if (gap >= MIN_GAP) {
                found.add(new Found(new MigraineReport.Recurrence(labels.get(id), c[1], c[0], c[3], c[2]), gap));
            }
        });
        found.sort((a, b) -> Double.compare(b.gap(), a.gap()));
        return found.stream().limit(MAX_RECURRENCES).map(Found::recurrence).toList();
    }

    private static Double feature(DayResults day, String name) {
        return day == null ? null : day.features().get(name);
    }

    private static Double deviation(DayResults day, String name) {
        return day == null ? null : day.deviations().get(name);
    }

    private static String level(int score, int medium, int high) {
        return score >= high ? "high" : score >= medium ? "medium" : "low";
    }

    /** Stesse zone dell'app: il nome «rischio» sta nel titolo, la zona dice solo quanto va guardato. */
    private static String zone(String level) {
        return switch (level) {
            case "high" -> "attenzione";
            case "medium" -> "buono";
            default -> "ottimo";
        };
    }

    private static String comparison(int today, int yesterday) {
        int change = today - yesterday;
        if (change == 0) {
            return "Come ieri (" + yesterday + ").";
        }
        return "Ieri era " + yesterday + ": oggi " + (change > 0 ? "più alto" : "più basso") + " di " + Math.abs(change) + " punti.";
    }
}
