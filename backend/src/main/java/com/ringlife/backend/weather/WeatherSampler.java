package com.ringlife.backend.weather;

import java.time.Clock;
import java.time.Duration;
import java.util.OptionalDouble;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.ringlife.backend.ha.HaPublisher;
import com.ringlife.backend.plugin.PluginService;

/**
 * Legge pressione e indice UV ogni ora e all'avvio, li salva e rivaluta i plugin (ADR 0017, 0031). Non lancia mai e
 * non fa mai fallire altro: un errore di HA salta la lettura, e si registra al piu' una volta l'ora. Pressione e UV sono
 * indipendenti: manca uno, si salva l'altro.
 */
@Component
class WeatherSampler {

    private static final Logger LOG = LoggerFactory.getLogger(WeatherSampler.class);

    /** Le letture si tengono 90 giorni. */
    static final Duration RETENTION = Duration.ofDays(90);

    private final WeatherSettings settings;
    private final WeatherClient client;
    private final PressureRepository repository;
    private final UvRepository uv;
    private final PluginService plugins;
    private final HaPublisher publisher;
    private final Clock clock;

    WeatherSampler(
            WeatherSettings settings,
            WeatherClient client,
            PressureRepository repository,
            UvRepository uv,
            PluginService plugins,
            HaPublisher publisher,
            Clock clock) {
        this.settings = settings;
        this.client = client;
        this.repository = repository;
        this.uv = uv;
        this.plugins = plugins;
        this.publisher = publisher;
        this.clock = clock;
    }

    @EventListener(ApplicationReadyEvent.class)
    void onStart() {
        sample();
    }

    /** Cinque minuti dopo ogni ora piena. */
    @Scheduled(cron = "0 5 * * * *")
    void hourly() {
        sample();
    }

    /** Una lettura: salvata se credibile, poi i plugin si rivalutano. `true` se ha salvato qualcosa. */
    boolean sample() {
        if (!settings.enabled()) {
            return false;
        }
        long now = clock.millis();
        boolean pressureSaved = samplePressure(now);
        boolean uvSaved = sampleUv(now);
        if (!pressureSaved && !uvSaved) {
            return false;
        }
        plugins.evaluateEveryDevice();
        publisher.publishLatestDevice();
        return true;
    }

    private boolean samplePressure(long now) {
        try {
            OptionalDouble pressure = client.currentPressureHpa();
            if (pressure.isEmpty()) {
                LOG.warn("Pressione non disponibile dall'entita' meteo: nessun valore credibile.");
                return false;
            }
            repository.save(now, pressure.getAsDouble());
            repository.deleteBefore(now - RETENTION.toMillis());
            return true;
        } catch (RuntimeException e) {
            LOG.warn("Lettura della pressione fallita: {}", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            return false;
        }
    }

    /** L'indice UV. Molte entita' meteo non lo hanno: un valore assente non si registra nei log, un errore si'. */
    private boolean sampleUv(long now) {
        try {
            OptionalDouble index = client.currentUvIndex();
            if (index.isEmpty()) {
                return false;
            }
            uv.save(now, index.getAsDouble());
            uv.deleteBefore(now - RETENTION.toMillis());
            return true;
        } catch (RuntimeException e) {
            LOG.warn("Lettura dell'indice UV fallita: {}", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            return false;
        }
    }
}
