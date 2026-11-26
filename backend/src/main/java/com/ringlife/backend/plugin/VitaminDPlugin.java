package com.ringlife.backend.plugin;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.springframework.stereotype.Component;

import com.ringlife.backend.plugin.PluginManifest.Field;
import com.ringlife.backend.weather.UvReading;

/**
 * Vitamina D (ADR 0031): dall'indice UV di Home Assistant e dal fototipo, quanti minuti al sole bastano per la
 * vitamina D e dopo quanti si rischia la scottatura. Stime da formule generali (docs/scores.md), non misure: l'anello
 * non vede il sole. Suggerimenti di abitudine, non consigli medici.
 */
@Component
class VitaminDPlugin implements Plugin {

    static final String ID = "vitamin-d";

    /** Dose eritemale minima per fototipo da 1 a 6, in J/m² (docs/scores.md). Valori iniziali tipici, non misure. */
    static final int[] MED_J_M2 = {200, 250, 300, 450, 600, 1000};

    /** Quota della dose eritemale minima che basta alla vitamina D, con viso e braccia scoperti. Regola pratica iniziale. */
    static final double VITAMIN_D_SHARE = 0.25;

    /** Sotto questo indice la pelle produce poca vitamina D. */
    static final double MIN_USEFUL_UV = 3;

    /** Gli indici della tabella. */
    static final int[] TABLE_UV = {3, 5, 7, 9};

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Vitamina D",
            "Quanti minuti al sole bastano per la vitamina D con l'indice UV di casa, e dopo quanti si rischia la scottatura.",
            "1",
            List.of("Indice UV da Home Assistant"),
            List.of(Field.integer("skinType", "Fototipo: da 1 (pelle chiarissima, si scotta sempre) a 6 (pelle molto scura)", 3, 1, 6)),
            List.of(),
            PluginManifest.DAILY);

    @Override
    public String id() {
        return ID;
    }

    @Override
    public PluginManifest manifest() {
        return manifest;
    }

    /** Minuti al sole per arrivare alla dose eritemale minima: UV 1 = 0,025 W/m², cioè 1,5 J/m² al minuto. */
    static double minutesToBurn(double uv, int skinType) {
        return MED_J_M2[skinType - 1] / (1.5 * uv);
    }

    static double minutesForVitaminD(double uv, int skinType) {
        return VITAMIN_D_SHARE * minutesToBurn(uv, skinType);
    }

    /** Arrotonda come si direbbe a voce: al minuto sotto i 10, ai 5 minuti sopra. */
    static long rough(double minutes) {
        return minutes < 10 ? Math.max(1, Math.round(minutes)) : 5 * Math.round(minutes / 5);
    }

    @Override
    public PluginResult evaluate(PluginContext context, LocalDate day) {
        int skinType = context.intConfig("skinType");
        ZoneId zone = context.zone();
        Instant dayStart = day.atStartOfDay(zone).toInstant();
        Instant dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant();
        Instant until = context.now().isBefore(dayEnd) ? context.now() : dayEnd;
        Optional<UvReading> today = peak(context.uv().between(dayStart, until));
        Optional<UvReading> yesterday = peak(context.uv().between(day.minusDays(1).atStartOfDay(zone).toInstant(), dayStart));

        if (today.isEmpty() && yesterday.isEmpty()) {
            return new PluginResult(
                    List.of(new Card.Text(
                            "Vitamina D",
                            "Serve l'indice UV da Home Assistant. Nelle opzioni dell'app RingLife scegli un'entità meteo che lo dia "
                                    + "(attributo uv_index) oppure un sensore UV (opzione uv_entity).")),
                    List.of());
        }

        // Il riferimento: il picco più alto tra ieri e oggi finora. Al mattino l'UV è basso, ieri dice di più.
        boolean fromToday = today.isPresent() && (yesterday.isEmpty() || today.get().index() >= yesterday.get().index());
        UvReading reference = fromToday ? today.get() : yesterday.get();
        String source = fromToday ? "il picco di oggi" : "il picco di ieri";
        double uv = reference.index();

        List<Card> cards = new ArrayList<>();
        PluginResult.Headline headline;
        if (uv < MIN_USEFUL_UV) {
            headline = PluginResult.Headline.of("UV basso oggi");
            cards.add(new Card.Text(
                    "Poco sole utile",
                    "Con UV " + format(uv) + " (" + source + ") la pelle produce poca vitamina D, anche stando a lungo al sole. "
                            + "Sotto UV " + format(MIN_USEFUL_UV) + " succede spesso da ottobre a marzo."));
        } else {
            headline = PluginResult.Headline.of(rough(minutesForVitaminD(uv, skinType)) + " min di sole");
            cards.add(new Card.Text(
                    "Minuti al sole",
                    "Con UV " + format(uv) + " (" + source + ") e fototipo " + skinType + " bastano circa "
                            + rough(minutesForVitaminD(uv, skinType)) + " minuti al sole nelle ore centrali, con viso e braccia "
                            + "scoperti. Dopo circa " + rough(minutesToBurn(uv, skinType)) + " minuti rischi la scottatura: "
                            + "oltre, meglio ombra o protezione."));
        }
        cards.add(new Card.ListCard(
                "Indice UV",
                List.of(
                        new Card.Row("Picco di ieri", describe(yesterday, zone)),
                        new Card.Row("Oggi finora", describe(today, zone)),
                        new Card.Row("Fototipo", String.valueOf(skinType)))));
        List<Card.Row> table = new ArrayList<>();
        for (int value : TABLE_UV) {
            table.add(new Card.Row(
                    "UV " + value,
                    "vitamina D " + rough(minutesForVitaminD(value, skinType)) + " min · scottatura dopo "
                            + rough(minutesToBurn(value, skinType)) + " min"));
        }
        cards.add(new Card.ListCard("Minuti al sole per fototipo " + skinType, table));
        cards.add(new Card.Text(
                null,
                "Stime da formule generali con valori iniziali, non misure: l'anello non vede il sole. Non sono consigli medici."));
        return new PluginResult(cards, List.of(), List.of(), headline);
    }

    private static Optional<UvReading> peak(List<UvReading> readings) {
        return readings.stream().max(Comparator.comparingDouble(UvReading::index));
    }

    private static String describe(Optional<UvReading> reading, ZoneId zone) {
        return reading
                .map(r -> "UV " + format(r.index()) + " alle " + TIME.format(r.at().atZone(zone)))
                .orElse("nessuna lettura");
    }

    /** «5» o «4,5». */
    static String format(double value) {
        double rounded = Math.round(value * 10) / 10.0;
        return rounded == Math.rint(rounded)
                ? String.valueOf((long) rounded)
                : String.format(Locale.ITALY, "%.1f", rounded);
    }
}
