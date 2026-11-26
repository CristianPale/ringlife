package com.ringlife.backend.plugin;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.compute.DailyComputationService;
import com.ringlife.backend.compute.ComputeSettings;

/**
 * Report delle cefalee per il medico (ADR 0019). L'autenticazione e' nell'interceptor del dispositivo. Il PDF si
 * costruisce in memoria e non si salva: i dati escono dal server solo come risposta a questa richiesta.
 */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/reports/migraine")
class MigraineReportController {

    /** Periodi ammessi, in giorni. */
    static final Set<Integer> PERIODS = Set.of(30, 90, 180);

    private final PluginService plugins;
    private final MigrainePlugin migraine;
    private final DailyComputationService computation;
    private final ComputeSettings settings;
    private final java.time.Clock clock;

    MigraineReportController(
            PluginService plugins,
            MigrainePlugin migraine,
            DailyComputationService computation,
            ComputeSettings settings,
            java.time.Clock clock) {
        this.plugins = plugins;
        this.migraine = migraine;
        this.computation = computation;
        this.settings = settings;
        this.clock = clock;
    }

    /** Il contenuto del report in JSON: l'anteprima dell'app, prima di creare il PDF. */
    @GetMapping("/summary")
    MigraineReport.Data summary(@PathVariable String deviceId, @RequestParam(defaultValue = "90") int days) {
        return data(deviceId, days);
    }

    @GetMapping(produces = MediaType.APPLICATION_PDF_VALUE)
    ResponseEntity<byte[]> pdf(@PathVariable String deviceId, @RequestParam(defaultValue = "90") int days) {
        MigraineReport.Data data = data(deviceId, days);
        byte[] bytes = new MigrainePdf().render(data, Instant.now(clock), settings.zone());
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"report-cefalee-" + data.to() + ".pdf\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(bytes);
    }

    private MigraineReport.Data data(String deviceId, int days) {
        if (!PERIODS.contains(days)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Periodo non valido: 30, 90 o 180 giorni");
        }
        LocalDate today = computation.today();
        return migraine.reportData(plugins.contextFor(deviceId, MigrainePlugin.ID, today), today, days);
    }
}
