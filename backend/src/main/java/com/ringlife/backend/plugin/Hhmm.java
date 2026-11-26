package com.ringlife.backend.plugin;

import java.util.Locale;

/** Orari «HH:mm» come minuti dopo la mezzanotte, e il contrario. */
final class Hhmm {

    static final int DAY_MINUTES = 24 * 60;

    private Hhmm() {}

    /** «07:30» -> 450. La forma e' gia' validata dal manifest. */
    static int minutes(String text) {
        return Integer.parseInt(text.substring(0, 2)) * 60 + Integer.parseInt(text.substring(3, 5));
    }

    /** 450 -> «07:30». Vale su 24 ore: 1500 -> «01:00», -60 -> «23:00». */
    static String format(long minutes) {
        long wrapped = Math.floorMod(minutes, (long) DAY_MINUTES);
        return String.format(Locale.ROOT, "%02d:%02d", wrapped / 60, wrapped % 60);
    }

    /** La differenza `a - b` portata nell'intervallo [-720, 720): su un cerchio di 24 ore, vince la strada piu' corta. */
    static double circularDiff(double a, double b) {
        double diff = Math.floorMod((long) Math.round((a - b) * 1000), (long) DAY_MINUTES * 1000) / 1000.0;
        return diff >= DAY_MINUTES / 2.0 ? diff - DAY_MINUTES : diff;
    }
}
