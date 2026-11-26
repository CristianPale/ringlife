package com.ringlife.backend.weather;

import java.util.Locale;
import java.util.OptionalDouble;

/** Conversione della pressione in hPa e controllo di credibilita' (ADR 0017). */
final class PressureUnits {

    static final double MIN_HPA = 800;
    static final double MAX_HPA = 1100;

    private PressureUnits() {}

    /** Il valore in hPa, o vuoto se l'unita' e' sconosciuta o il risultato esce da 800-1100. */
    static OptionalDouble toHpa(double value, String unit) {
        String key = unit == null ? "hpa" : unit.trim().toLowerCase(Locale.ROOT);
        double hpa;
        switch (key) {
            case "hpa", "mbar", "mb" -> hpa = value;
            case "kpa" -> hpa = value * 10;
            case "pa" -> hpa = value / 100;
            case "inhg" -> hpa = value * 33.8639;
            case "mmhg" -> hpa = value * 1.33322;
            default -> {
                return OptionalDouble.empty();
            }
        }
        return Double.isFinite(hpa) && hpa >= MIN_HPA && hpa <= MAX_HPA ? OptionalDouble.of(hpa) : OptionalDouble.empty();
    }
}
