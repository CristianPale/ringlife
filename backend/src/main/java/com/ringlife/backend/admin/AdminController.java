package com.ringlife.backend.admin;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.compute.ComputationTrigger;

/**
 * Pulizia dei dati vecchi (ADR 0021), per togliere dati di prova caricati per sbaglio. Si autentica con il segreto di
 * registrazione, come la registrazione: senza segreto configurato non esiste (404). Non c'e' un pulsante nell'app.
 */
@RestController
@RequestMapping("/api/v1/admin")
class AdminController {

    record PurgeRequest(Long before) {}

    /** `alertEvents`: alert events deleted with the days they belong to (ADR 0045). */
    record PurgeResponse(int samples, int sleepSessions, int recomputedDevices, int alertEvents) {}

    /** Dati calcolati: si rifanno tutti dai dati grezzi rimasti (le baseline di prima non valgono piu'). */
    private static final List<String> DERIVED = List.of("daily_feature", "baseline", "daily_score", "daily_metric", "plugin_result");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ComputationTrigger computation;
    private final AlertService alerts;
    private final String secret;

    AdminController(
            JdbcTemplate jdbc,
            TransactionTemplate transaction,
            ComputationTrigger computation,
            AlertService alerts,
            @Value("${ringlife.pairing-secret:}") String secret) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.computation = computation;
        this.alerts = alerts;
        this.secret = secret;
    }

    /**
     * Cancella campioni e notti di sonno **precedenti** a `before` (millisecondi dall'epoca, UTC) e gli avvisi dei giorni
     * locali che ne hanno anche solo una parte prima di `before`, poi azzera tutti i valori calcolati e li ricalcola dai
     * dati rimasti. Non tocca il diario, gli episodi, i dispositivi e i plugin accesi.
     */
    @PostMapping("/purge")
    PurgeResponse purge(
            @RequestHeader(value = "X-Pairing-Secret", required = false) String given, @RequestBody PurgeRequest request) {
        if (secret.isBlank()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Non disponibile");
        }
        if (given == null || !MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), secret.getBytes(StandardCharsets.UTF_8))) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Segreto non valido");
        }
        if (request.before() == null || request.before() <= 0) {
            throw ApiException.badRequest("Campo obbligatorio: before (millisecondi)");
        }
        long before = request.before();

        int[] counts = new int[3];
        transaction.executeWithoutResult(status -> {
            counts[0] = jdbc.update("DELETE FROM sample WHERE ts < ?", before);
            // Le fasi seguono la sessione (ON DELETE CASCADE), ma SQLite le cancella solo con le chiavi esterne attive:
            // si cancellano a mano per non dipendere da quell'impostazione.
            jdbc.update("DELETE FROM sleep_stage WHERE session_id IN (SELECT id FROM sleep_session WHERE end_ts < ?)", before);
            counts[1] = jdbc.update("DELETE FROM sleep_session WHERE end_ts < ?", before);
            for (String table : DERIVED) {
                jdbc.update("DELETE FROM " + table);
            }
            // Gli avvisi dei giorni toccati dalla pulizia: quelli dei giorni dopo restano (un evento non si riscrive).
            counts[2] = alerts.deleteEventsBefore(before);
        });

        List<String> devices = jdbc.queryForList("SELECT id FROM device", String.class);
        for (String deviceId : devices) {
            Long earliest = jdbc.queryForObject(
                    "SELECT MIN(ts) FROM (SELECT MIN(ts) AS ts FROM sample WHERE device_id = ? UNION ALL SELECT MIN(start_ts) FROM sleep_session WHERE device_id = ?)",
                    Long.class, deviceId, deviceId);
            if (earliest != null) {
                computation.afterIngest(deviceId, earliest);
            }
        }
        return new PurgeResponse(counts[0], counts[1], devices.size(), counts[2]);
    }
}
