package com.ringlife.backend.plugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

/**
 * Il PDF del report per il medico (ADR 0019): solo testo e una tabella, con i font standard. Nessun nome, nessuna data di
 * nascita, nessuna nota libera: i dati sono quelli di {@link MigraineReport.Data}.
 */
final class MigrainePdf {

    static final String DISCLAIMER = "Documento generato da RingLife dai dati registrati dall'utente. Non è un documento medico.";
    static final String FOOTER = "I valori sono quelli scritti dall'utente. L'anello e le regole di rischio non fanno diagnosi. "
            + "Questo documento non contiene consigli su farmaci o terapie.";
    static final String RECURRENCE_CAUTION =
            "Sono coincidenze osservate nei dati registrati, non una prova che la causa sia questa. Il confronto è tra i giorni con cefalea e gli altri.";

    private static final float MARGIN = 40;
    private static final float WIDTH = PDRectangle.A4.getWidth() - 2 * MARGIN;
    private static final float LEADING = 1.35f;
    /** Colonne della tabella degli episodi: inizio, durata, picco, sintomi, lato, farmaci, cause. Somma = larghezza utile. */
    private static final float[] COLUMNS = {72, 52, 34, 108, 66, 84, 99};
    private static final String[] HEAD = {"Inizio", "Durata", "Picco", "Sintomi", "Lato", "Farmaci", "Cause"};

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ITALY);
    private static final DateTimeFormatter START = DateTimeFormatter.ofPattern("dd/MM HH:mm", Locale.ITALY);

    private final PDFont regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
    private final PDFont bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);

    private PDDocument document;
    private PDPageContentStream stream;
    private float y;
    private int pages;

    byte[] render(MigraineReport.Data data, Instant generatedAt, ZoneId zone) {
        try (PDDocument doc = new PDDocument()) {
            document = doc;
            doc.getDocumentInformation().setTitle("Report delle cefalee");
            doc.getDocumentInformation().setCreator("RingLife");
            newPage();

            text("Report delle cefalee", bold, 20);
            gap(4);
            text("Periodo: " + DAY.format(data.from()) + " - " + DAY.format(data.to()) + " (" + data.days() + " giorni)", regular, 10);
            text("Generato il " + DAY.format(generatedAt.atZone(zone)), regular, 10);
            gap(4);
            text(DISCLAIMER, regular, 9);
            gap(14);

            text("Riepilogo", bold, 13);
            gap(2);
            summary(data);
            gap(14);

            if (data.summary() != null) {
                text("Episodi", bold, 13);
                gap(4);
                table(data, zone);
                gap(14);
                text("Cosa ricorre nei giorni con cefalea", bold, 13);
                gap(2);
                recurrences(data);
            }
            stream.close();
            stream = null;
            footers();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Creazione del PDF non riuscita", e);
        }
    }

    private void summary(MigraineReport.Data data) throws IOException {
        MigraineReport.Summary s = data.summary();
        if (s == null) {
            text("Nessuna cefalea registrata nel periodo.", regular, 10);
            return;
        }
        text("Cefalee: " + s.episodes() + " (" + s.headacheDays() + " " + (s.headacheDays() == 1 ? "giorno" : "giorni") + " con cefalea).", regular, 10);
        text("Intensità: massima " + s.peakMax() + " su 10, picco medio " + String.format(Locale.ITALY, "%.1f", s.peakAverage()) + " su 10.", regular, 10);
        text(
                s.averageDurationMin() == null
                        ? "Durata media: non calcolabile, nessun episodio chiuso."
                        : "Durata media degli episodi chiusi: " + duration(s.averageDurationMin()) + ".",
                regular,
                10);
        text("Farmaci registrati: " + s.medicationIntakes() + " " + (s.medicationIntakes() == 1 ? "assunzione" : "assunzioni")
                + " in " + s.medicationDays() + " " + (s.medicationDays() == 1 ? "giorno" : "giorni") + ".", regular, 10);
    }

    private void table(MigraineReport.Data data, ZoneId zone) throws IOException {
        row(HEAD, bold, true);
        List<MigraineReport.EpisodeRow> episodes = new ArrayList<>(data.episodes());
        episodes.sort(Comparator.comparingLong(MigraineReport.EpisodeRow::start).reversed());
        for (MigraineReport.EpisodeRow e : episodes) {
            String durationText = e.end() == null ? "in corso" : duration((e.end() - e.start()) / 60_000);
            String medication = e.medicationCount() == 0
                    ? "nessuno"
                    : e.medicationCount() + (e.medicationHelp() == null ? "" : " (" + MigraineReport.help(e.medicationHelp()) + ")");
            row(
                    new String[] {
                        START.format(Instant.ofEpochMilli(e.start()).atZone(zone)),
                        durationText,
                        e.peak() + "/10",
                        join(e.symptoms().stream().map(MigraineReport::symptom).toList()),
                        e.location() == null ? "-" : MigraineReport.location(e.location()),
                        medication,
                        join(e.causes().stream().map(MigraineReport::cause).toList())
                    },
                    regular,
                    false);
        }
    }

    private void recurrences(MigraineReport.Data data) throws IOException {
        if (data.summary().episodes() < 5) {
            text("Con meno di 5 cefalee non si cercano ricorrenze: ne servono di più.", regular, 10);
            return;
        }
        if (data.recurrences().isEmpty()) {
            text("Nessuna condizione ricorre nei giorni con cefalea in modo evidente.", regular, 10);
        } else {
            for (MigraineReport.Recurrence r : data.recurrences()) {
                text(r.label() + ": " + r.describe() + " (giorni con cefalea contro gli altri giorni).", regular, 10);
            }
        }
        gap(4);
        text(RECURRENCE_CAUTION, regular, 9);
    }

    private static String join(List<String> items) {
        return items.isEmpty() ? "-" : String.join(", ", items);
    }

    private static String duration(long minutes) {
        return (minutes / 60) + " h " + String.format(Locale.ROOT, "%02d", minutes % 60) + " min";
    }

    // --- impaginazione ---------------------------------------------------------------------------------------------

    private void newPage() throws IOException {
        if (stream != null) {
            stream.close();
        }
        PDPage page = new PDPage(PDRectangle.A4);
        document.addPage(page);
        stream = new PDPageContentStream(document, page);
        pages++;
        y = PDRectangle.A4.getHeight() - MARGIN;
    }

    private void ensure(float height) throws IOException {
        if (y - height < MARGIN + 30) {
            newPage();
        }
    }

    private void gap(float points) {
        y -= points;
    }

    private void text(String content, PDFont font, float size) throws IOException {
        for (String line : wrap(content, font, size, WIDTH)) {
            ensure(size * LEADING);
            stream.beginText();
            stream.setFont(font, size);
            stream.newLineAtOffset(MARGIN, y - size);
            stream.showText(line);
            stream.endText();
            y -= size * LEADING;
        }
    }

    /** Una riga di tabella: ogni cella va a capo nella sua colonna, la riga è alta quanto la cella più alta. */
    private void row(String[] cells, PDFont font, boolean header) throws IOException {
        float size = 8.5f;
        List<List<String>> wrapped = new ArrayList<>();
        int lines = 1;
        for (int i = 0; i < cells.length; i++) {
            List<String> w = wrap(cells[i], font, size, COLUMNS[i] - 6);
            wrapped.add(w);
            lines = Math.max(lines, w.size());
        }
        float height = lines * size * LEADING + 6;
        ensure(height);
        if (header) {
            stream.setNonStrokingColor(0.92f);
            stream.addRect(MARGIN, y - height, WIDTH, height);
            stream.fill();
            stream.setNonStrokingColor(0f);
        }
        float x = MARGIN;
        for (int i = 0; i < cells.length; i++) {
            float lineY = y - 3 - size;
            for (String line : wrapped.get(i)) {
                stream.beginText();
                stream.setFont(font, size);
                stream.newLineAtOffset(x + 3, lineY);
                stream.showText(line);
                stream.endText();
                lineY -= size * LEADING;
            }
            x += COLUMNS[i];
        }
        stream.setStrokingColor(0.8f);
        stream.moveTo(MARGIN, y - height);
        stream.lineTo(MARGIN + WIDTH, y - height);
        stream.stroke();
        stream.setStrokingColor(0f);
        y -= height;
    }

    private void footers() throws IOException {
        int total = document.getNumberOfPages();
        for (int i = 0; i < total; i++) {
            try (PDPageContentStream s = new PDPageContentStream(document, document.getPage(i), PDPageContentStream.AppendMode.APPEND, true)) {
                float footerY = MARGIN - 6 + 24;
                for (String line : wrap(FOOTER, regular, 7.5f, WIDTH - 60)) {
                    s.beginText();
                    s.setFont(regular, 7.5f);
                    s.newLineAtOffset(MARGIN, footerY);
                    s.showText(line);
                    s.endText();
                    footerY -= 9;
                }
                String page = "Pagina " + (i + 1) + " di " + total;
                s.beginText();
                s.setFont(regular, 7.5f);
                s.newLineAtOffset(MARGIN + WIDTH - regular.getStringWidth(page) / 1000 * 7.5f, MARGIN - 6 + 24);
                s.showText(page);
                s.endText();
            }
        }
    }

    // --- testo -----------------------------------------------------------------------------------------------------

    private List<String> wrap(String content, PDFont font, float size, float width) throws IOException {
        List<String> lines = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : safe(content, font).split(" ")) {
            String candidate = current.isEmpty() ? word : current + " " + word;
            if (!current.isEmpty() && font.getStringWidth(candidate) / 1000 * size > width) {
                lines.add(current.toString());
                current = new StringBuilder(word);
            } else {
                current = new StringBuilder(candidate);
            }
        }
        lines.add(current.toString());
        return lines;
    }

    /** I font standard non hanno tutti i caratteri: quelli che non si codificano diventano «?» invece di far fallire il PDF. */
    private static String safe(String content, PDFont font) {
        StringBuilder out = new StringBuilder();
        content.codePoints().forEach(cp -> {
            String c = new String(Character.toChars(cp));
            try {
                font.encode(c);
                out.append(c);
            } catch (IOException | IllegalArgumentException e) {
                out.append('?');
            }
        });
        return out.toString();
    }
}
