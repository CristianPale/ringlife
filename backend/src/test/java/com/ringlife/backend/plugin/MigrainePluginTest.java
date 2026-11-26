package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ringlife.backend.compute.History;
import com.ringlife.backend.compute.History.DayResults;
import com.ringlife.backend.diary.DiaryLog;

/** Emicrania v1 su giornate sintetiche (ADR 0014). */
class MigrainePluginTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");

    private final MigrainePlugin plugin = new MigrainePlugin();

    /** Un diario in memoria: solo bevande. */
    private static DiaryLog diary(boolean logs, List<DiaryLog.Drink> drinks) {
        return diary(logs, drinks, List.of());
    }

    private static DiaryLog diary(boolean logs, List<DiaryLog.Drink> drinks, List<DiaryLog.Headache> headaches) {
        return new DiaryLog() {
            @Override
            public List<Drink> drinks(String deviceId, long fromMs, long toMs) {
                return drinks.stream().filter(d -> d.ts() >= fromMs && d.ts() < toMs).toList();
            }

            @Override
            public List<Headache> headaches(String deviceId, long fromMs, long toMs) {
                return headaches.stream().filter(h -> h.start() >= fromMs && h.start() < toMs).toList();
            }

            @Override
            public List<HeadacheDetails> headacheDetails(String deviceId, long fromMs, long toMs) {
                return List.of();
            }

            @Override
            public boolean hasDrinkEntriesSince(String deviceId, long fromMs) {
                return logs;
            }
        };
    }

    private static History history(List<DayResults> days) {
        return (device, from, to) -> days.stream().filter(d -> !d.day().isBefore(from) && !d.day().isAfter(to)).toList();
    }

    /** Una notte buona: nessuna condizione scatta, ma i dati ci sono. */
    private static DayResults goodNight(LocalDate day) {
        return new DayResults(
                day,
                Map.of("sleep_regularity", 90),
                Map.of("sleep_debt", 0.5),
                Map.of("sleep_asleep_min", 480.0, "hrv_night", 50.0, "resting_hr", 55.0, "temp_night", 36.0, "stress_high_share", 0.1),
                Map.of("hrv_night", 0.2, "resting_hr", -0.1, "temp_night", 0.3));
    }

    private static DayResults night(LocalDate day, double asleepMin, Double hrvDev, Double rhrDev, Double debt, Integer regularity, Double tempDev, Double stress) {
        Map<String, Double> features = new HashMap<>();
        features.put("sleep_asleep_min", asleepMin);
        if (stress != null) {
            features.put("stress_high_share", stress);
        }
        Map<String, Double> deviations = new HashMap<>();
        if (hrvDev != null) {
            deviations.put("hrv_night", hrvDev);
            features.put("hrv_night", 40.0);
        }
        if (rhrDev != null) {
            deviations.put("resting_hr", rhrDev);
            features.put("resting_hr", 60.0);
        }
        if (tempDev != null) {
            deviations.put("temp_night", tempDev);
            features.put("temp_night", 36.0);
        }
        Map<String, Integer> scores = regularity == null ? Map.of() : Map.of("sleep_regularity", regularity);
        Map<String, Double> metrics = debt == null ? Map.of() : Map.of("sleep_debt", debt);
        return new DayResults(day, scores, metrics, features, deviations);
    }

    private PluginResult run(List<DayResults> days, DiaryLog diary) {
        return run(days, diary, Map.of());
    }

    private PluginResult run(List<DayResults> days, DiaryLog diary, Map<String, Object> chosen) {
        PluginContext context = new PluginContext("dev", TODAY, NOW, ZONE, plugin.manifest().complete(chosen), history(days), diary);
        return plugin.evaluate(context, TODAY);
    }

    private static Card.Score score(PluginResult result) {
        return result.cards().stream().filter(Card.Score.class::isInstance).map(Card.Score.class::cast).findFirst().orElseThrow();
    }

    private static PluginResult.EntityState entity(PluginResult result) {
        return result.entities().get(0);
    }

    @Test
    void aGoodNightMeansLowRiskWithAllConditionsEvaluated() {
        PluginResult result = run(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY)), diary(true, List.of()));
        assertThat(score(result).value()).isZero();
        assertThat(score(result).zone()).isEqualTo("ottimo");
        assertThat(score(result).caption()).contains("Valutate 9 condizioni su 10");
        assertThat(entity(result).state()).isEqualTo("low");
        assertThat(entity(result).attributes()).containsEntry("score", 0).containsEntry("evaluated", 9);
    }

    @Test
    void everyConditionAddsItsOwnWeight() {
        // Sonno corto 20, HRV bassa 20, battito alto 10, debito 10, irregolare 10, temperatura 5, stress ieri 10 = 85.
        DayResults yesterday = night(TODAY.minusDays(1), 480, null, null, null, null, null, 0.5);
        DayResults today = night(TODAY, 300, -1.5, 1.2, 5.0, 40, 2.5, null);
        PluginResult result = run(List.of(yesterday, today), diary(false, List.of()));
        assertThat(score(result).value()).isEqualTo(85);
        assertThat(score(result).zone()).isEqualTo("attenzione");
        assertThat(entity(result).state()).isEqualTo("high");
    }

    @Test
    void contributorsAreListedHeaviestFirstWithTheirPoints() {
        DayResults today = night(TODAY, 300, -1.5, 1.2, 0.0, 90, 0.0, null);
        PluginResult result = run(List.of(today), diary(false, List.of()));
        Card.ListCard list = result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast).findFirst().orElseThrow();
        assertThat(list.rows()).extracting(Card.Row::label).containsExactly("Sonno corto", "Variabilità cardiaca bassa", "Battito a riposo alto");
        assertThat(list.rows()).extracting(Card.Row::value).containsExactly("+20", "+20", "+10");
    }

    @Test
    void aHighRiskGetsAnInsightWithoutClinicalAdvice() {
        DayResults today = night(TODAY, 300, -2.0, 2.0, 6.0, 40, null, null);
        PluginResult result = run(List.of(today), diary(false, List.of()));
        assertThat(result.insights()).hasSize(1);
        assertThat(result.insights().get(0).level()).isEqualTo("attenzione");
        assertThat(result.insights().get(0).text()).startsWith("Pesano:").contains("sonno corto");
    }

    @Test
    void theScoreIsCappedAtOneHundred() {
        // 20+20+10+10+10+5+10 = 85 dai dati, +20 dal diario = 105 -> 100.
        DayResults yesterday = night(TODAY.minusDays(1), 480, null, null, null, null, null, 0.9);
        DayResults today = night(TODAY, 200, -3.0, 3.0, 8.0, 10, 3.0, null);
        long ts = NOW.minusSeconds(3600).toEpochMilli();
        List<DiaryLog.Drink> drinks = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            drinks.add(new DiaryLog.Drink(ts - i * 60_000L, "caffeine"));
        }
        drinks.add(new DiaryLog.Drink(ts, "alcohol"));
        PluginResult result = run(List.of(yesterday, today), diary(true, drinks));
        assertThat(score(result).value()).isEqualTo(100);
    }

    @Test
    void diaryConditionsCountOnlyWhenTheUserLogsDrinks() {
        long ts = NOW.minusSeconds(3600).toEpochMilli();
        List<DiaryLog.Drink> drinks = List.of(new DiaryLog.Drink(ts, "alcohol"));
        DayResults today = goodNight(TODAY);

        PluginResult logged = run(List.of(today), diary(true, drinks));
        assertThat(score(logged).value()).isEqualTo(10);
        assertThat(score(logged).caption()).contains("Valutate 8 condizioni su 10");

        PluginResult notLogged = run(List.of(today), diary(false, drinks));
        assertThat(score(notLogged).value()).isZero();
        assertThat(score(notLogged).caption()).contains("Valutate 6 condizioni su 10");
    }

    @Test
    void onlyTheLast24HoursOfDrinksCount() {
        long old = NOW.minusSeconds(30 * 3600L).toEpochMilli();
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of(new DiaryLog.Drink(old, "alcohol"))));
        assertThat(score(result).value()).isZero();
    }

    @Test
    void withTooFewSignalsItShowsNoNumberAndSaysWhatIsMissing() {
        DayResults thin = new DayResults(TODAY, Map.of(), Map.of(), Map.of("sleep_asleep_min", 300.0), Map.of());
        PluginResult result = run(List.of(thin), diary(false, List.of()));
        assertThat(result.cards().stream().anyMatch(Card.Score.class::isInstance)).isFalse();
        Card.Text text = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).findFirst().orElseThrow();
        assertThat(text.body()).contains("Non ci sono ancora abbastanza dati").contains("Valutati oggi: 1 su 10");
        assertThat(entity(result).state()).isNull();
        assertThat(result.cards().get(result.cards().size() - 1)).isInstanceOf(Card.Action.class);
    }

    @Test
    void aMissingDayIsNotACondition() {
        PluginResult result = run(List.of(), diary(false, List.of()));
        assertThat(entity(result).state()).isNull();
        assertThat(result.insights()).isEmpty();
    }

    @Test
    void itComparesWithYesterdayWhenYesterdayHasEnoughData() {
        DayResults yesterday = night(TODAY.minusDays(1), 480, 0.0, 0.0, 0.0, 90, null, null);
        DayResults today = night(TODAY, 300, 0.0, 0.0, 0.0, 90, null, null);
        // Con una sola notte non si valuta il confronto: ieri ha dati per 4 condizioni (HRV, battito, debito, regolarità) + sonno.
        PluginResult result = run(List.of(yesterday, today), diary(false, List.of()));
        String comparison = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).map(Card.Text::body).findFirst().orElse("");
        assertThat(comparison).startsWith("Ieri era 0").contains("più alto di 20 punti");
    }

    @Test
    void thresholdsAreConfigurable() {
        DayResults today = night(TODAY, 330, 0.0, 0.0, 0.0, 90, 0.0, null);
        assertThat(score(run(List.of(today), diary(false, List.of()))).value()).isEqualTo(20);
        assertThat(score(run(List.of(today), diary(false, List.of()), Map.of("sleepHours", 5))).value()).isZero();
    }

    @Test
    void theZonesFollowTheConfiguredLimitsAndHighIsAlwaysAboveMedium() {
        DayResults today = night(TODAY, 300, -1.5, 0.0, 0.0, 90, 0.0, null);
        assertThat(entity(run(List.of(today), diary(false, List.of()))).state()).isEqualTo("medium");
        assertThat(entity(run(List.of(today), diary(false, List.of()), Map.of("mediumFrom", 10, "highFrom", 40))).state()).isEqualTo("high");
        // highFrom <= mediumFrom non capovolge le zone: alto e' sempre sopra il medio.
        assertThat(entity(run(List.of(today), diary(false, List.of()), Map.of("mediumFrom", 60, "highFrom", 40))).state()).isEqualTo("low");
    }

    @Test
    void theCardAlwaysSaysItIsNotADiagnosisAndIgnoresPressure() {
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of()));
        assertThat(score(result).caption()).contains("non una diagnosi").contains("pressione atmosferica");
    }

    private static PluginResult.Headline headline(PluginResult result) {
        assertThat(result.headline()).isNotNull();
        assertThat(result.headline().value()).hasSizeLessThanOrEqualTo(24);
        return result.headline();
    }

    @Test
    void theHeadlineSaysTheLevelAndAsksForALookFromMedium() {
        PluginResult low = run(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY)), diary(true, List.of()));
        assertThat(headline(low)).isEqualTo(new PluginResult.Headline("Rischio basso", null));

        PluginResult medium = run(List.of(night(TODAY, 300, -1.5, 0.0, 0.0, 90, 0.0, null)), diary(false, List.of()));
        assertThat(entity(medium).state()).isEqualTo("medium");
        assertThat(headline(medium)).isEqualTo(new PluginResult.Headline("Rischio medio", "attenzione"));

        DayResults yesterday = night(TODAY.minusDays(1), 480, null, null, null, null, null, 0.5);
        PluginResult high = run(List.of(yesterday, night(TODAY, 300, -1.5, 1.2, 5.0, 40, 2.5, null)), diary(false, List.of()));
        assertThat(entity(high).state()).isEqualTo("high");
        assertThat(headline(high)).isEqualTo(new PluginResult.Headline("Rischio alto", "attenzione"));
    }

    @Test
    void withTooFewSignalsTheHeadlineSaysSoWithoutANumber() {
        DayResults thin = new DayResults(TODAY, Map.of(), Map.of(), Map.of("sleep_asleep_min", 300.0), Map.of());
        assertThat(headline(run(List.of(thin), diary(false, List.of())))).isEqualTo(new PluginResult.Headline("Dati insufficienti", null));
        assertThat(headline(run(List.of(), diary(false, List.of())))).isEqualTo(new PluginResult.Headline("Dati insufficienti", null));
    }

    @Test
    void itIsADailyPlugin() {
        assertThat(plugin.manifest().cadence()).isEqualTo("daily");
    }

    @Test
    void itDeclaresItsEntityForHomeAssistant() {
        assertThat(plugin.manifest().entities()).hasSize(1);
        assertThat(plugin.manifest().entities().get(0).key()).isEqualTo("migraine_risk");
        assertThat(plugin.manifest().entities().get(0).options()).containsExactly("low", "medium", "high");
    }

    // --- riepilogo delle cefalee (ADR 0015) ---

    private static long at(LocalDate day, int hour) {
        return day.atTime(hour, 0).atZone(ZONE).toInstant().toEpochMilli();
    }

    private static DiaryLog.Headache headache(LocalDate day, int peak, int medication, Integer minutes) {
        long start = at(day, 9);
        return new DiaryLog.Headache(start, minutes == null ? null : start + minutes * 60_000L, peak, peak, medication);
    }

    /** Una storia di 31 giorni dove solo il sonno ha un dato: `shortOn` dormono 300 minuti, gli altri 480. */
    private static List<DayResults> sleepHistory(List<LocalDate> shortOn) {
        List<DayResults> days = new ArrayList<>();
        for (int i = 30; i >= 0; i--) {
            LocalDate day = TODAY.minusDays(i);
            days.add(new DayResults(day, Map.of(), Map.of(), Map.of("sleep_asleep_min", shortOn.contains(day) ? 300.0 : 480.0)));
        }
        return days;
    }

    private static Card.ListCard list(PluginResult result, String title) {
        return result.cards().stream()
                .filter(Card.ListCard.class::isInstance)
                .map(Card.ListCard.class::cast)
                .filter(c -> c.title().equals(title))
                .findFirst()
                .orElse(null);
    }

    private static String row(Card.ListCard card, String label) {
        return card.rows().stream().filter(r -> r.label().equals(label)).map(Card.Row::value).findFirst().orElseThrow();
    }

    @Test
    void withNoHeadachesTheReportSaysSoAndSearchesNothing() {
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of()));
        Card.Text text = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast)
                .filter(t -> "Cefalee, ultimi 30 giorni".equals(t.title())).findFirst().orElseThrow();
        assertThat(text.body()).contains("Nessuna cefalea");
        assertThat(list(result, "Cosa ricorre nei giorni con cefalea")).isNull();
    }

    @Test
    void theReportCountsEpisodesDaysPeakMedicationAndAverageDuration() {
        List<DiaryLog.Headache> headaches = List.of(
                headache(TODAY.minusDays(2), 6, 1, 90),
                headache(TODAY.minusDays(2).plusDays(0), 4, 0, 30),
                headache(TODAY.minusDays(10), 8, 2, null));
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of(), headaches));
        Card.ListCard card = list(result, "Cefalee, ultimi 30 giorni");
        assertThat(row(card, "Cefalee")).isEqualTo("3");
        assertThat(row(card, "Giorni con cefalea")).isEqualTo("2");
        assertThat(row(card, "Intensità massima")).isEqualTo("8 su 10");
        assertThat(row(card, "Giorni con farmaci registrati")).isEqualTo("2");
        assertThat(row(card, "Durata media")).isEqualTo("1 h 00 min");
    }

    @Test
    void anOpenEpisodeHasNoDurationAndIsStillCounted() {
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of(), List.of(headache(TODAY, 5, 0, null))));
        Card.ListCard card = list(result, "Cefalee, ultimi 30 giorni");
        assertThat(row(card, "Cefalee")).isEqualTo("1");
        assertThat(card.rows().stream().anyMatch(r -> r.label().equals("Durata media"))).isFalse();
    }

    @Test
    void anEpisodeBelongsToTheLocalDayItStartedIn() {
        // 23:30 UTC del 3 novembre sono le 00:30 del 4 a Roma: giorno locale diverso da quello UTC.
        long start = Instant.parse("2026-11-03T23:30:00Z").toEpochMilli();
        DiaryLog.Headache lateNight = new DiaryLog.Headache(start, null, 5, 5, 1);
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of(), List.of(lateNight, headache(TODAY, 3, 0, null))));
        // Entrambi sono il 4 novembre locale: un solo giorno con cefalea.
        assertThat(row(list(result, "Cefalee, ultimi 30 giorni"), "Giorni con cefalea")).isEqualTo("1");
    }

    @Test
    void episodesOutsideTheLastThirtyDaysAreLeftOut() {
        PluginResult result = run(List.of(goodNight(TODAY)), diary(true, List.of(), List.of(headache(TODAY.minusDays(31), 9, 0, null), headache(TODAY.minusDays(29), 4, 0, null))));
        Card.ListCard card = list(result, "Cefalee, ultimi 30 giorni");
        assertThat(row(card, "Cefalee")).isEqualTo("1");
        assertThat(row(card, "Intensità massima")).isEqualTo("4 su 10");
    }

    @Test
    void withFewerThanFiveHeadachesItSaysMoreAreNeededAndFindsNoRecurrence() {
        List<LocalDate> headacheDays = List.of(TODAY.minusDays(3), TODAY.minusDays(8), TODAY.minusDays(15), TODAY.minusDays(20));
        List<DiaryLog.Headache> headaches = headacheDays.stream().map(d -> headache(d, 5, 0, 60)).toList();
        PluginResult result = run(sleepHistory(headacheDays), diary(false, List.of(), headaches));
        assertThat(list(result, "Cosa ricorre nei giorni con cefalea")).isNull();
        String texts = result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).map(Card.Text::body).reduce("", String::concat);
        assertThat(texts).contains("Con meno di 5 cefalee");
    }

    @Test
    void aConditionThatRecursOnHeadacheDaysMuchMoreThanOnOthersIsReported() {
        List<LocalDate> headacheDays = List.of(
                TODAY.minusDays(2), TODAY.minusDays(5), TODAY.minusDays(9), TODAY.minusDays(14), TODAY.minusDays(20), TODAY.minusDays(25));
        List<DiaryLog.Headache> headaches = headacheDays.stream().map(d -> headache(d, 6, 0, 60)).toList();
        PluginResult result = run(sleepHistory(headacheDays), diary(false, List.of(), headaches));
        Card.ListCard recurrence = list(result, "Cosa ricorre nei giorni con cefalea");
        assertThat(recurrence).isNotNull();
        assertThat(row(recurrence, "Sonno corto")).isEqualTo("6 su 6 contro 0 su 24");
        assertThat(result.cards().stream().filter(Card.Text.class::isInstance).map(Card.Text.class::cast).map(Card.Text::body)
                .anyMatch(b -> b.contains("non una prova che la causa sia questa"))).isTrue();
    }

    @Test
    void aSimilarShareOnHeadacheDaysAndOtherDaysIsNotARecurrence() {
        List<LocalDate> headacheDays = List.of(
                TODAY.minusDays(2), TODAY.minusDays(5), TODAY.minusDays(9), TODAY.minusDays(14), TODAY.minusDays(20), TODAY.minusDays(25));
        List<DiaryLog.Headache> headaches = headacheDays.stream().map(d -> headache(d, 6, 0, 60)).toList();
        // Dormono poco i giorni 1, 2, 3, 4, 5, 6, 7... a caso: meta' dei giorni con cefalea e meta' degli altri.
        List<LocalDate> shortOn = new ArrayList<>(headacheDays.subList(0, 3));
        for (int i = 1; i <= 30; i++) {
            LocalDate d = TODAY.minusDays(i);
            if (!headacheDays.contains(d) && i % 2 == 0) {
                shortOn.add(d);
            }
        }
        PluginResult result = run(sleepHistory(shortOn), diary(false, List.of(), headaches));
        assertThat(list(result, "Cosa ricorre nei giorni con cefalea")).isNull();
    }

    @Test
    void aConditionOnlyOnOneHeadacheDayIsNotEnough() {
        List<LocalDate> headacheDays = List.of(
                TODAY.minusDays(2), TODAY.minusDays(5), TODAY.minusDays(9), TODAY.minusDays(14), TODAY.minusDays(20), TODAY.minusDays(25));
        List<DiaryLog.Headache> headaches = headacheDays.stream().map(d -> headache(d, 6, 0, 60)).toList();
        PluginResult result = run(sleepHistory(List.of(headacheDays.get(0))), diary(false, List.of(), headaches));
        assertThat(list(result, "Cosa ricorre nei giorni con cefalea")).isNull();
    }

    @Test
    void theReportIsShownEvenWhenTodayHasTooFewSignalsForAScore() {
        DayResults thin = new DayResults(TODAY, Map.of(), Map.of(), Map.of("sleep_asleep_min", 300.0));
        PluginResult result = run(List.of(thin), diary(false, List.of(), List.of(headache(TODAY.minusDays(1), 5, 0, 60))));
        assertThat(result.cards().stream().anyMatch(Card.Score.class::isInstance)).isFalse();
        assertThat(list(result, "Cefalee, ultimi 30 giorni")).isNotNull();
        assertThat(result.cards().get(result.cards().size() - 1)).isInstanceOf(Card.Action.class);
    }

    @Test
    void theLogicChangedSoTheVersionMovedOn() {
        assertThat(plugin.manifest().version()).isEqualTo("3");
    }

    private PluginResult runWithPressure(double change) {
        PluginContext context = new PluginContext(
                "dev", TODAY, NOW, ZONE, plugin.manifest().complete(Map.of()),
                history(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY))), diary(true, List.of()),
                at -> java.util.OptionalDouble.of(change));
        return plugin.evaluate(context, TODAY);
    }

    @Test
    void aPressureDropOfTheThresholdOrMoreAddsPoints() {
        PluginResult result = runWithPressure(-6);
        assertThat(score(result).value()).isEqualTo(10);
        assertThat(score(result).caption()).contains("Valutate 10 condizioni su 10").doesNotContain("pressione atmosferica non");
        assertThat(entity(result).attributes()).containsEntry("evaluated", 10);
        assertThat(result.cards().stream().filter(Card.ListCard.class::isInstance).map(Card.ListCard.class::cast)
                .anyMatch(l -> l.rows().stream().anyMatch(r -> r.label().equals("Calo di pressione")))).isTrue();
    }

    @Test
    void aSmallDropOrARiseDoesNotCount() {
        assertThat(score(runWithPressure(-5.9)).value()).isZero();
        assertThat(score(runWithPressure(8)).value()).isZero();
    }

    @Test
    void theThresholdIsConfigurable() {
        PluginContext context = new PluginContext(
                "dev", TODAY, NOW, ZONE, plugin.manifest().complete(Map.of("pressureDrop", 3)),
                history(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY))), diary(true, List.of()),
                at -> java.util.OptionalDouble.of(-3.5));
        assertThat(score(plugin.evaluate(context, TODAY)).value()).isEqualTo(10);
    }

    @Test
    void withoutPressureReadingsTheConditionIsNotEvaluatedAndTheCaptionSaysWhy() {
        PluginResult result = run(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY)), diary(true, List.of()));
        assertThat(entity(result).attributes()).containsEntry("evaluated", 9);
        assertThat(score(result).caption()).contains("pressione atmosferica non è ancora disponibile");
    }

    // --- alerts (ADR 0045) ---

    @Test
    void aHighRiskRaisesTheMigraineAlertWithTheHeaviestContributors() {
        DayResults yesterday = night(TODAY.minusDays(1), 480, null, null, null, null, null, 0.5);
        PluginResult high = run(List.of(yesterday, night(TODAY, 300, -1.5, 1.2, 5.0, 40, 2.5, null)), diary(false, List.of()));
        assertThat(high.alerts()).hasSize(1);
        PluginResult.Alert alert = high.alerts().get(0);
        assertThat(alert.rule()).isEqualTo("migraine-risk");
        assertThat(alert.title()).isEqualTo("Rischio emicrania alto oggi");
        assertThat(alert.body()).isEqualTo("Stima 85 su 100. Pesano sonno corto, variabilità cardiaca bassa e battito a riposo alto. "
                + "Pause, acqua e pasti regolari possono aiutare.");
        assertThat(alert.values()).containsEntry("score", 85);
    }

    @Test
    void mediumLowAndThinRisksRaiseNoAlert() {
        assertThat(run(List.of(night(TODAY, 300, -1.5, 0.0, 0.0, 90, 0.0, null)), diary(false, List.of())).alerts()).isEmpty();
        assertThat(run(List.of(goodNight(TODAY.minusDays(1)), goodNight(TODAY)), diary(true, List.of())).alerts()).isEmpty();
        assertThat(run(List.of(), diary(false, List.of())).alerts()).isEmpty();
    }
}
