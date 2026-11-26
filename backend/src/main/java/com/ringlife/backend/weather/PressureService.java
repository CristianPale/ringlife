package com.ringlife.backend.weather;

import java.time.Duration;
import java.time.Instant;
import java.util.OptionalDouble;

import org.springframework.stereotype.Service;

/** {@link PressureHistory} sulle letture salvate (ADR 0017). */
@Service
class PressureService implements PressureHistory {

    /** Quanto lontana dall'istante cercato puo' essere una lettura. */
    static final Duration TOLERANCE = Duration.ofMinutes(90);

    private final PressureRepository repository;

    PressureService(PressureRepository repository) {
        this.repository = repository;
    }

    @Override
    public OptionalDouble change24h(Instant at) {
        OptionalDouble now = repository.nearest(at.toEpochMilli(), TOLERANCE.toMillis());
        OptionalDouble before = repository.nearest(at.minus(Duration.ofHours(24)).toEpochMilli(), TOLERANCE.toMillis());
        if (now.isEmpty() || before.isEmpty()) {
            return OptionalDouble.empty();
        }
        return OptionalDouble.of(now.getAsDouble() - before.getAsDouble());
    }
}
