package com.ringlife.backend.plugin;

import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

/**
 * Una card per la UI (ADR 0013). Cinque tipi; l'app ignora quelli che non conosce. I testi sono gia' in italiano.
 * I valori fuori dai limiti rifiutano la costruzione: un plugin sbagliato non produce una card che l'app non sa disegnare.
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = Card.Score.class, name = "score"),
    @JsonSubTypes.Type(value = Card.Trend.class, name = "trend"),
    @JsonSubTypes.Type(value = Card.ListCard.class, name = "list"),
    @JsonSubTypes.Type(value = Card.Text.class, name = "text"),
    @JsonSubTypes.Type(value = Card.Action.class, name = "action")
})
public sealed interface Card {

    /** Zone di un indice: le stesse dell'app. */
    Set<String> ZONES = Set.of("ottimo", "buono", "attenzione");

    /** Azioni che l'app sa eseguire. Mai un indirizzo web. */
    Set<String> ACTIONS = Set.of("open-diary", "log-headache", "open-breathing");

    /** Un valore 0-100 con la sua zona. */
    record Score(String title, int value, String zone, String caption) implements Card {
        public Score {
            require(title);
            if (value < 0 || value > 100 || !ZONES.contains(zone)) {
                throw new IllegalArgumentException("score");
            }
        }
    }

    /** Una serie di punti (null = giorno senza dato). */
    record Trend(String title, List<Double> points, String unit, String caption) implements Card {
        public Trend {
            require(title);
            // Un punto puo' essere null (giorno senza dato): List.copyOf non lo ammette.
            points = points == null ? List.of() : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(points));
        }
    }

    record Row(String label, String value) {
        public Row {
            require(label);
            require(value);
        }
    }

    record ListCard(String title, List<Row> rows) implements Card {
        public ListCard {
            require(title);
            rows = List.copyOf(rows);
        }
    }

    record Text(String title, String body) implements Card {
        public Text {
            require(body);
        }
    }

    record Action(String label, String action) implements Card {
        public Action {
            require(label);
            if (!ACTIONS.contains(action)) {
                throw new IllegalArgumentException("action");
            }
        }
    }

    private static void require(String text) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("text");
        }
    }
}
