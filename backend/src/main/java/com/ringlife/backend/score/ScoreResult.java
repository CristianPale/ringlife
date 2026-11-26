package com.ringlife.backend.score;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Un indice con i suoi componenti: si salvano sempre, per spiegare il punteggio in UI. */
public record ScoreResult(String algoVersion, int value, List<Component> components) {

    public static final String V1 = "v1";

    /** Un contributore: sotto-punteggio 0-100 e peso nominale. Se `score` e' null il dato mancava. */
    public record Component(String id, double weight, Integer score) {
        public boolean missing() {
            return score == null;
        }
    }

    /** Un indice si calcola solo se almeno meta' del peso ha un dato. */
    static final double MIN_PRESENT_WEIGHT = 0.5;

    /**
     * Somma pesata dei componenti presenti. I pesi dei componenti mancanti si ridistribuiscono sugli altri:
     * senza dato non si inventa un valore, ma un solo segnale assente non azzera l'indice.
     */
    static Optional<ScoreResult> combine(List<Component> components) {
        double present = components.stream().filter(c -> !c.missing()).mapToDouble(Component::weight).sum();
        if (present < MIN_PRESENT_WEIGHT - 1e-9) {
            return Optional.empty();
        }
        double total = 0;
        for (Component c : components) {
            if (!c.missing()) {
                total += c.weight() * c.score();
            }
        }
        return Optional.of(new ScoreResult(V1, Stats.round(total / present), new ArrayList<>(components)));
    }

    static Component component(String id, double weight, Integer score) {
        return new Component(id, weight, score);
    }

    /** Sotto-punteggio da uno scostamento orientato (positivo = meglio): 75 sulla tua media, +/-12,5 per scostamento. */
    static int fromDeviation(double orientedDeviation) {
        return Stats.round(Stats.clamp(75 + 12.5 * orientedDeviation, 0, 100));
    }

    static int ratioScore(double value, double full) {
        return full <= 0 ? 0 : Stats.round(Stats.clamp(value / full * 100, 0, 100));
    }
}
