package com.ringlife.backend.weather;

import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;

/** {@link UvHistory} sulle letture salvate (ADR 0031). */
@Service
class UvService implements UvHistory {

    private final UvRepository repository;

    UvService(UvRepository repository) {
        this.repository = repository;
    }

    @Override
    public List<UvReading> between(Instant from, Instant to) {
        return repository.between(from.toEpochMilli(), to.toEpochMilli());
    }
}
