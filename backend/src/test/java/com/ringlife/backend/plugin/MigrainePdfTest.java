package com.ringlife.backend.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

/** Il PDF del report al medico (ADR 0019) su dati sintetici: si rilegge e si controlla il testo. */
class MigrainePdfTest {

    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");
    private static final LocalDate TO = LocalDate.of(2026, 11, 4);

    private static long at(String iso) {
        return Instant.parse(iso).toEpochMilli();
    }

    private static MigraineReport.EpisodeRow episode(String start, Long end, int peak, int meds, String help) {
        return new MigraineReport.EpisodeRow(
                at(start), end, peak, List.of("nausea", "photophobia"), "left", meds, help, List.of("stress", "little_sleep"));
    }

    private static String render(MigraineReport.Data data) throws IOException {
        byte[] pdf = new MigrainePdf().render(data, NOW, ZONE);
        assertThat(new String(pdf, 0, 5)).isEqualTo("%PDF-");
        try (PDDocument document = Loader.loadPDF(pdf)) {
            return new PDFTextStripper().getText(document).replaceAll("\\s+", " ");
        }
    }

    private static MigraineReport.Data data(List<MigraineReport.EpisodeRow> rows, List<MigraineReport.Recurrence> recurrences) {
        MigraineReport.Summary summary = new MigraineReport.Summary(rows.size(), rows.size(), 8, 6.5, 1, 3, 125L);
        return new MigraineReport.Data(TO.minusDays(89), TO, 90, rows.isEmpty() ? null : summary, rows, recurrences);
    }

    @Test
    void saysWhoMadeItAndThatItIsNotMedical() throws IOException {
        String text = render(data(List.of(episode("2026-10-20T07:00:00Z", at("2026-10-20T09:05:00Z"), 8, 2, "a_lot")), List.of()));
        assertThat(text)
                .contains("Report delle cefalee")
                .contains("Periodo: 07/08/2026 - 04/11/2026 (90 giorni)")
                .contains("Generato il 04/11/2026")
                .contains("Documento generato da RingLife")
                .contains("Non è un documento medico")
                .contains("non contiene consigli su farmaci o terapie");
    }

    @Test
    void showsTheSummaryAndOneRowPerEpisodeNewestFirst() throws IOException {
        List<MigraineReport.EpisodeRow> rows = List.of(
                episode("2026-10-01T07:00:00Z", at("2026-10-01T08:00:00Z"), 5, 0, null),
                episode("2026-10-20T07:00:00Z", null, 8, 2, "a_little"));
        String text = render(data(rows, List.of()));
        assertThat(text).contains("Cefalee: 2 (2 giorni con cefalea).").contains("massima 8 su 10").contains("picco medio 6,5 su 10");
        assertThat(text).contains("Durata media degli episodi chiusi: 2 h 05 min").contains("3 assunzioni in 1 giorno");
        assertThat(text).contains("in corso").contains("2 (poco)").contains("nessuno").contains("fotofobia, nausea".replace("fotofobia, nausea", "nausea, fotofobia"));
        assertThat(text.indexOf("20/10 09:00")).isLessThan(text.indexOf("01/10 09:00"));
    }

    @Test
    void usesItalianNamesNotCodes() throws IOException {
        String text = render(data(List.of(episode("2026-10-20T07:00:00Z", null, 6, 1, "not_at_all")), List.of()));
        assertThat(text).contains("sinistra").contains("poco sonno").contains("per niente");
        assertThat(text).doesNotContain("photophobia").doesNotContain("little_sleep").doesNotContain("not_at_all");
    }

    @Test
    void withoutHeadachesItSaysSoAndHasNoTable() throws IOException {
        String text = render(data(List.of(), List.of()));
        assertThat(text).contains("Nessuna cefalea registrata nel periodo.").doesNotContain("Episodi").doesNotContain("Cosa ricorre");
    }

    @Test
    void belowFiveEpisodesItDoesNotLookForRecurrences() throws IOException {
        String text = render(data(List.of(episode("2026-10-20T07:00:00Z", null, 6, 0, null)), List.of()));
        assertThat(text).contains("Con meno di 5 cefalee non si cercano ricorrenze");
    }

    @Test
    void recurrencesComeWithTheCaution() throws IOException {
        List<MigraineReport.EpisodeRow> rows = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            rows.add(episode("2026-10-" + String.format("%02d", i + 1) + "T07:00:00Z", null, 6, 0, null));
        }
        String text = render(data(rows, List.of(new MigraineReport.Recurrence("Sonno corto", 4, 5, 3, 20))));
        assertThat(text).contains("Sonno corto: 4 su 5 contro 3 su 20").contains("non una prova che la causa sia questa");
    }

    @Test
    void manyEpisodesFlowOntoMoreNumberedPages() throws IOException {
        List<MigraineReport.EpisodeRow> rows = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            rows.add(episode("2026-09-" + String.format("%02d", i % 28 + 1) + "T" + String.format("%02d", i % 24) + ":00:00Z", null, 6, 1, "a_lot"));
        }
        byte[] pdf = new MigrainePdf().render(data(rows, List.of()), NOW, ZONE);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isGreaterThan(2);
            String text = new PDFTextStripper().getText(document).replaceAll("\\s+", " ");
            assertThat(text).contains("Pagina 1 di " + document.getNumberOfPages()).contains("Pagina " + document.getNumberOfPages() + " di " + document.getNumberOfPages());
        }
    }

    @Test
    void textTheFontCannotEncodeBecomesAQuestionMarkInsteadOfFailing() throws IOException {
        MigraineReport.Data data = data(List.of(new MigraineReport.EpisodeRow(
                at("2026-10-20T07:00:00Z"), null, 6, List.of("→"), "left", 0, null, List.of())), List.of());
        assertThat(render(data)).contains("?");
    }
}
