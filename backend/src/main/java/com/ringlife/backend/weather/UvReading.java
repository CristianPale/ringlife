package com.ringlife.backend.weather;

import java.time.Instant;

/** Una lettura dell'indice UV di Home Assistant (ADR 0031). */
public record UvReading(Instant at, double index) {}
