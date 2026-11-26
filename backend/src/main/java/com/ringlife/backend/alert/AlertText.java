package com.ringlife.backend.alert;

import java.util.Locale;

/** Italian number and «in a row» wording for the alert texts: decimal comma, real minus sign, ordinals. */
final class AlertText {

    private AlertText() {}

    /** The minus sign used in the UI (U+2212), not the hyphen. */
    static final char MINUS = '−';

    private static final String[] FEMININE = {"", "prima", "seconda", "terza", "quarta", "quinta", "sesta", "settima", "ottava", "nona", "decima"};
    private static final String[] MASCULINE = {"", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo"};

    /** «+0,6», «−12», «0»: sign always shown, decimal comma, at most `decimals` decimals. */
    static String signed(double value, int decimals) {
        String magnitude = decimal(Math.abs(value), decimals);
        if (magnitude.equals(decimal(0, decimals))) {
            return magnitude;
        }
        return (value < 0 ? String.valueOf(MINUS) : "+") + magnitude;
    }

    /** «7,5», «7», «94,5»: decimal comma, at most `decimals` decimals, no trailing «,0». */
    static String decimal(double value, int decimals) {
        String text = String.format(Locale.ITALY, "%." + decimals + "f", value);
        if (decimals > 0 && text.contains(",")) {
            text = text.replaceAll("0+$", "");
            if (text.endsWith(",")) {
                text = text.substring(0, text.length() - 1);
            }
        }
        return text.startsWith("-") ? MINUS + text.substring(1) : text;
    }

    /** «4.000»: thousands with a dot, as in Italian. */
    static String thousands(double value) {
        return String.format(Locale.ITALY, "%,d", Math.round(value));
    }

    /** «la seconda notte di fila», «l'ottava notte di fila», «da 12 notti di fila». For streaks of 2 or more. */
    static String nightsInARow(int streak) {
        if (streak > 10) {
            return "da " + streak + " notti di fila";
        }
        String ordinal = FEMININE[streak];
        return (startsWithVowel(ordinal) ? "l'" : "la ") + ordinal + " notte di fila";
    }

    /** «per il terzo giorno di fila», «per l'ottavo giorno di fila», «da 12 giorni di fila». For streaks of 2 or more. */
    static String daysInARow(int streak) {
        if (streak > 10) {
            return "da " + streak + " giorni di fila";
        }
        String ordinal = MASCULINE[streak];
        return "per " + (startsWithVowel(ordinal) ? "l'" : "il ") + ordinal + " giorno di fila";
    }

    private static boolean startsWithVowel(String word) {
        return !word.isEmpty() && "aeiou".indexOf(word.charAt(0)) >= 0;
    }
}
