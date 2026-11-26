package com.ringlife.backend.diary;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.diary.DiaryDtos.DiaryRequest;
import com.ringlife.backend.diary.DiaryDtos.Entry;
import com.ringlife.backend.diary.DiaryDtos.Episode;

/**
 * Controlli sul diario in arrivo. Come per i campioni, un elemento non valido rifiuta tutta la richiesta e i
 * messaggi non citano i valori ricevuti (sono dati sanitari).
 */
@Component
class DiaryValidator {

    static final int MAX_ENTRIES = 500;
    static final int MAX_EPISODES = 100;
    static final int MAX_DELETED = 1000;
    static final int MAX_NOTE = 1000;
    static final int MAX_POINTS = 200;
    static final int MAX_MEDICATIONS = 50;
    static final Set<String> KINDS = Set.of("caffeine", "alcohol", "note");
    static final Set<String> CAFFEINE = Set.of("coffee", "tea", "energy", "other");
    static final Set<String> ALCOHOL = Set.of("wine", "beer", "spirits", "other");
    static final Set<String> SYMPTOMS = Set.of("photophobia", "nausea", "phonophobia", "aura", "other");
    static final Set<String> LOCATIONS = Set.of("left", "right", "both", "nape");
    static final Set<String> HELP = Set.of("a_lot", "a_little", "not_at_all");
    static final Set<String> CAUSES = Set.of("little_sleep", "stress", "skipped_meal", "weather", "screens", "other");

    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final long EARLIEST_TS = Instant.parse("2020-01-01T00:00:00Z").toEpochMilli();
    private static final Duration FUTURE_SLACK = Duration.ofDays(1);

    private final Clock clock;

    DiaryValidator(Clock clock) {
        this.clock = clock;
    }

    void validate(DiaryRequest request) {
        List<Entry> entries = nullToEmpty(request.entries());
        List<Episode> episodes = nullToEmpty(request.episodes());
        List<String> deletedEntries = nullToEmpty(request.deletedEntries());
        List<String> deletedEpisodes = nullToEmpty(request.deletedEpisodes());
        if (entries.size() > MAX_ENTRIES || episodes.size() > MAX_EPISODES
                || deletedEntries.size() > MAX_DELETED || deletedEpisodes.size() > MAX_DELETED) {
            throw ApiException.badRequest("Troppi elementi nella richiesta");
        }

        Set<String> entryIds = new HashSet<>();
        for (Entry entry : entries) {
            entry(entry);
            unique(entryIds, entry.id());
        }
        Set<String> episodeIds = new HashSet<>();
        for (Episode episode : episodes) {
            episode(episode);
            unique(episodeIds, episode.id());
        }
        for (String id : deletedEntries) {
            id(id);
            unique(entryIds, id);
        }
        for (String id : deletedEpisodes) {
            id(id);
            unique(episodeIds, id);
        }
    }

    private void entry(Entry entry) {
        if (entry == null) {
            throw ApiException.badRequest("Voce non valida");
        }
        id(entry.id());
        timestamp(entry.ts());
        if (entry.kind() == null || !KINDS.contains(entry.kind())) {
            throw ApiException.badRequest("Tipo di voce sconosciuto");
        }
        switch (entry.kind()) {
            case "caffeine" -> oneOf(entry.drink(), CAFFEINE, "Bevanda non valida");
            case "alcohol" -> oneOf(entry.drink(), ALCOHOL, "Bevanda non valida");
            default -> {
                if (entry.text() == null || entry.text().isBlank() || entry.text().length() > MAX_NOTE) {
                    throw ApiException.badRequest("Nota non valida");
                }
            }
        }
    }

    private void episode(Episode episode) {
        if (episode == null) {
            throw ApiException.badRequest("Episodio non valido");
        }
        id(episode.id());
        timestamp(episode.start());
        if (episode.end() != null) {
            timestamp(episode.end());
            if (episode.end() < episode.start()) {
                throw ApiException.badRequest("La fine precede l'inizio");
            }
        }
        if (episode.completedAt() != null) {
            timestamp(episode.completedAt());
        }
        intensity(episode.intensity());
        List<DiaryDtos.IntensityPoint> points = nullToEmpty(episode.intensityLog());
        if (points.size() > MAX_POINTS) {
            throw ApiException.badRequest("Troppe misure di intensita'");
        }
        for (DiaryDtos.IntensityPoint point : points) {
            if (point == null) {
                throw ApiException.badRequest("Misura di intensita' non valida");
            }
            timestamp(point.at());
            intensity(point.value());
        }
        List<Long> medications = nullToEmpty(episode.medicationAt());
        if (medications.size() > MAX_MEDICATIONS) {
            throw ApiException.badRequest("Troppi farmaci segnati");
        }
        for (Long at : medications) {
            if (at == null) {
                throw ApiException.badRequest("Farmaco non valido");
            }
            timestamp(at);
        }
        details(episode.details());
    }

    private void details(DiaryDtos.Details details) {
        if (details == null) {
            return;
        }
        for (String symptom : nullToEmpty(details.symptoms())) {
            oneOf(symptom, SYMPTOMS, "Sintomo sconosciuto");
        }
        for (String cause : nullToEmpty(details.causes())) {
            oneOf(cause, CAUSES, "Causa sconosciuta");
        }
        if (details.location() != null) {
            oneOf(details.location(), LOCATIONS, "Localizzazione sconosciuta");
        }
        if (details.medicationHelp() != null) {
            oneOf(details.medicationHelp(), HELP, "Efficacia non valida");
        }
        if (details.notes() != null && details.notes().length() > MAX_NOTE) {
            throw ApiException.badRequest("Note troppo lunghe");
        }
    }

    private void id(String id) {
        if (id == null || !ID.matcher(id).matches()) {
            throw ApiException.badRequest("Identificativo non valido");
        }
    }

    private void timestamp(long ts) {
        if (ts < EARLIEST_TS || ts > clock.millis() + FUTURE_SLACK.toMillis()) {
            throw ApiException.badRequest("Timestamp fuori intervallo");
        }
    }

    private static void intensity(int value) {
        if (value < 1 || value > 10) {
            throw ApiException.badRequest("Intensita' fuori intervallo");
        }
    }

    private static void oneOf(String value, Set<String> allowed, String message) {
        if (value == null || !allowed.contains(value)) {
            throw ApiException.badRequest(message);
        }
    }

    private static void unique(Set<String> seen, String id) {
        if (!seen.add(id)) {
            throw ApiException.badRequest("Identificativo ripetuto nella richiesta");
        }
    }

    private static <T> List<T> nullToEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }
}
