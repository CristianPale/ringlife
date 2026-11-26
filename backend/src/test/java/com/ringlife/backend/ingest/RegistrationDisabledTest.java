package com.ringlife.backend.ingest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Senza `RINGLIFE_PAIRING_SECRET` la registrazione e' spenta, anche se qualcuno invia un segreto vuoto. */
@SpringBootTest
@AutoConfigureMockMvc
class RegistrationDisabledTest {

    private static final Path DB_DIR = createTempDir();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("disabled.sqlite").toString());
        registry.add("ringlife.pairing-secret", () -> "");
    }

    @Autowired
    MockMvc mvc;

    @Test
    void registrationIsNotAvailable() throws Exception {
        mvc.perform(post("/api/v1/devices")
                        .header("X-Pairing-Secret", "")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"hardwareId\":\"x\",\"model\":\"y\"}"))
                .andExpect(status().isNotFound());
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-disabled-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
