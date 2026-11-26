package com.ringlife.backend.ingest;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.ingest.IngestDtos.Session;
import com.ringlife.backend.ingest.IngestDtos.Stage;

/**
 * Controlli sui dati in arrivo. Un solo elemento non valido rifiuta tutta la richiesta: il telefono non
 * riceve mai un successo parziale e puo' ripetere la richiesta intera. I messaggi non citano i valori ricevuti.
 */
@Component
class IngestValidator {

    static final int MAX_SAMPLES = 5000;
    static final int MAX_SESSIONS = 31;
    static final int MAX_STAGES = 500;
    static final Set<String> METRICS = Set.of("HR", "SPO2", "STRESS", "HRV", "TEMP", "STEPS", "CALORIES");
    static final Set<String> STAGES = Set.of("deep", "light", "rem", "awake");

    private static final long EARLIEST_TS = Instant.parse("2020-01-01T00:00:00Z").toEpochMilli();
    private static final Duration FUTURE_SLACK = Duration.ofDays(1);
    private static final Duration MAX_SESSION = Duration.ofHours(24);
    private static final int MAX_OFFSET_MIN = 14 * 60;

    private final Clock clock;

    IngestValidator(Clock clock) {
        this.clock = clock;
    }

    int offset(Integer tzOffsetMin) {
        if (tzOffsetMin == null) {
            throw ApiException.badRequest("Campo obbligatorio: tzOffsetMin");
        }
        if (Math.abs(tzOffsetMin) > MAX_OFFSET_MIN) {
            throw ApiException.badRequest("tzOffsetMin fuori intervallo");
        }
        return tzOffsetMin;
    }

    void timestamp(long ts, String what) {
        if (ts < EARLIEST_TS || ts > clock.millis() + FUTURE_SLACK.toMillis()) {
            throw ApiException.badRequest("Timestamp fuori intervallo: " + what);
        }
    }

    void samples(List<IngestDtos.Sample> samples) {
        if (samples == null) {
            throw ApiException.badRequest("Campo obbligatorio: samples");
        }
        if (samples.size() > MAX_SAMPLES) {
            throw ApiException.badRequest("Troppi campioni: massimo " + MAX_SAMPLES);
        }
        for (IngestDtos.Sample sample : samples) {
            if (sample == null || sample.metric() == null || !METRICS.contains(sample.metric())) {
                throw ApiException.badRequest("Metrica sconosciuta");
            }
            if (!Double.isFinite(sample.value())) {
                throw ApiException.badRequest("Valore non valido");
            }
            timestamp(sample.ts(), "campione");
        }
    }

    void sessions(List<Session> sessions) {
        if (sessions == null) {
            throw ApiException.badRequest("Campo obbligatorio: sessions");
        }
        if (sessions.size() > MAX_SESSIONS) {
            throw ApiException.badRequest("Troppe sessioni: massimo " + MAX_SESSIONS);
        }
        for (Session session : sessions) {
            if (session == null) {
                throw ApiException.badRequest("Sessione non valida");
            }
            timestamp(session.start(), "inizio sessione");
            timestamp(session.end(), "fine sessione");
            if (session.end() <= session.start()) {
                throw ApiException.badRequest("La sessione deve finire dopo l'inizio");
            }
            if (session.end() - session.start() > MAX_SESSION.toMillis()) {
                throw ApiException.badRequest("Sessione piu' lunga di 24 ore");
            }
            stages(session);
        }
    }

    private void stages(Session session) {
        List<Stage> stages = session.stages() == null ? List.of() : session.stages();
        if (stages.size() > MAX_STAGES) {
            throw ApiException.badRequest("Troppe fasi in una sessione: massimo " + MAX_STAGES);
        }
        List<Stage> ordered = new ArrayList<>(stages);
        for (Stage stage : ordered) {
            if (stage == null || stage.stage() == null || !STAGES.contains(stage.stage())) {
                throw ApiException.badRequest("Fase del sonno sconosciuta");
            }
            if (stage.end() <= stage.start()) {
                throw ApiException.badRequest("Una fase deve finire dopo l'inizio");
            }
            if (stage.start() < session.start() || stage.end() > session.end()) {
                throw ApiException.badRequest("Una fase esce dalla sessione");
            }
        }
        ordered.sort((a, b) -> Long.compare(a.start(), b.start()));
        for (int i = 1; i < ordered.size(); i++) {
            if (ordered.get(i).start() < ordered.get(i - 1).end()) {
                throw ApiException.badRequest("Fasi del sonno sovrapposte");
            }
        }
    }
}
