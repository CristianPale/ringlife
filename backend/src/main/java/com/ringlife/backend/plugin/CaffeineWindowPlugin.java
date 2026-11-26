package com.ringlife.backend.plugin;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.ringlife.backend.diary.DiaryLog;
import com.ringlife.backend.plugin.PluginManifest.Field;

/**
 * Finestra caffeina (ADR 0016): dall'orario di risveglio e dall'obiettivo di sonno, quando conviene iniziare e
 * quando smettere. Orari fissi, mai un «adesso»: un risultato si salva e invecchia.
 */
@Component
class CaffeineWindowPlugin implements Plugin {

    static final String ID = "caffeine-window";

    private final PluginManifest manifest = new PluginManifest(
            ID,
            "Finestra caffeina",
            "Da che ora iniziare e a che ora smettere con la caffeina, dal tuo risveglio e dal tuo obiettivo di sonno.",
            "1",
            List.of("Diario (caffeina)"),
            List.of(
                    Field.time("wakeTime", "Risveglio abituale", "07:00"),
                    Field.integer("sleepGoalHours", "Obiettivo di sonno: ore", 8, 5, 10),
                    Field.integer("delayMinutes", "Attesa dopo il risveglio: minuti", 90, 0, 180),
                    Field.integer("cutoffHours", "Stop prima di coricarsi: ore", 8, 4, 12)),
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

    @Override
    public PluginResult evaluate(PluginContext context, LocalDate day) {
        int wake = Hhmm.minutes(context.timeConfig("wakeTime"));
        int goal = context.intConfig("sleepGoalHours") * 60;
        int start = wake + context.intConfig("delayMinutes");
        int bedtime = wake + Hhmm.DAY_MINUTES - goal;
        int stop = bedtime - context.intConfig("cutoffHours") * 60;

        if (stop <= start) {
            return new PluginResult(
                    List.of(new Card.Text(
                            "Finestra caffeina",
                            "Con questi parametri la finestra è vuota: lo stop cade prima dell'inizio. "
                                    + "Riduci le ore di stop o l'attesa dopo il risveglio, nelle impostazioni del plugin.")),
                    List.of(),
                    List.of(),
                    PluginResult.Headline.attention("Finestra vuota"));
        }

        List<Card> cards = new ArrayList<>();
        cards.add(new Card.ListCard(
                "Finestra caffeina",
                List.of(
                        new Card.Row("Da", Hhmm.format(start)),
                        new Card.Row("Fino alle", Hhmm.format(stop)),
                        new Card.Row("Coricarsi", Hhmm.format(bedtime)))));
        cards.add(new Card.Text(
                null,
                "Orari da valori comuni, non da evidenze: " + context.intConfig("delayMinutes")
                        + " minuti dopo il risveglio e " + context.intConfig("cutoffHours")
                        + " ore prima di coricarsi. Puoi cambiarli nelle impostazioni del plugin. Sono suggerimenti di abitudine, non consigli medici."));

        List<PluginResult.Insight> insights = new ArrayList<>();
        Integer last = lastCaffeineToday(context, day);
        if (last != null && last > stop) {
            String text = "Oggi hai segnato caffeina alle " + Hhmm.format(last) + ", dopo le " + Hhmm.format(stop) + ".";
            cards.add(new Card.Text(null, text));
            insights.add(new PluginResult.Insight("info", "Caffeina dopo la fine della finestra", text));
        }
        return new PluginResult(cards, insights, List.of(), PluginResult.Headline.of(window(start, stop)));
    }

    /** "08:30 – 15:00": start and stop as on the card, en dash with spaces. */
    static String window(int start, int stop) {
        return Hhmm.format(start) + " – " + Hhmm.format(stop);
    }

    /** Minuti dopo la mezzanotte locale dell'ultima caffeina registrata oggi, null se non ce n'e'. */
    private static Integer lastCaffeineToday(PluginContext context, LocalDate day) {
        ZoneId zone = context.zone();
        long from = day.atStartOfDay(zone).toInstant().toEpochMilli();
        long to = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        return context.diary().drinks(context.deviceId(), from, to).stream()
                .filter(d -> "caffeine".equals(d.kind()))
                .map(DiaryLog.Drink::ts)
                .max(Long::compare)
                .map(ts -> {
                    var local = Instant.ofEpochMilli(ts).atZone(zone);
                    return local.getHour() * 60 + local.getMinute();
                })
                .orElse(null);
    }
}
