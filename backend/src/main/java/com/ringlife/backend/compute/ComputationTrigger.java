package com.ringlife.backend.compute;

import java.time.LocalDate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.ha.HaPublisher;
import com.ringlife.backend.plugin.PluginService;

/**
 * Quando si calcola (ADR 0009): dopo ogni caricamento e ogni notte. Un errore qui non fa mai fallire il
 * caricamento: i dati grezzi sono gia' al sicuro e il calcolo si ripete. Gli avvisi (ADR 0045) si valutano dopo i
 * plugin, sugli stessi giorni ricalcolati, e prima della pubblicazione in Home Assistant.
 */
@Component
@EnableScheduling
public class ComputationTrigger {

    private static final Logger LOG = LoggerFactory.getLogger(ComputationTrigger.class);

    /** Giorni ricalcolati dal job notturno: ieri diventa completo e prende l'indice Movimento. */
    static final int NIGHTLY_DAYS = 3;

    private final DailyComputationService service;
    private final HaPublisher publisher;
    private final PluginService plugins;
    private final AlertService alerts;

    ComputationTrigger(DailyComputationService service, HaPublisher publisher, PluginService plugins, AlertService alerts) {
        this.service = service;
        this.publisher = publisher;
        this.plugins = plugins;
        this.alerts = alerts;
    }

    /** Ricalcola dal giorno del dato piu' vecchio appena caricato fino a oggi. */
    public void afterIngest(String deviceId, long earliestTsMs) {
        try {
            LocalDate from = service.dayOf(earliestTsMs);
            service.recomputeFrom(deviceId, from);
            plugins.evaluateAll(deviceId);
            alerts.evaluateFrom(deviceId, from);
            publisher.publish(deviceId);
        } catch (RuntimeException e) {
            // Solo il tipo dell'errore: il messaggio potrebbe contenere valori.
            LOG.warn("Calcolo giornaliero fallito dopo un caricamento: {}", e.getClass().getSimpleName());
        }
    }

    @Scheduled(cron = "${ringlife.compute.cron:0 15 4 * * *}", zone = "${ringlife.zone:Europe/Rome}")
    void nightly() {
        service.recomputeRecent(NIGHTLY_DAYS);
        plugins.evaluateEveryDevice();
        alerts.evaluateRecent(NIGHTLY_DAYS);
        publisher.publishLatestDevice();
    }
}
