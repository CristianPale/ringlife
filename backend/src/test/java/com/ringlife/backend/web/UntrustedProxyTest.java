package com.ringlife.backend.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Una richiesta che non arriva da un proxy fidato non puo' falsificare indirizzo e protocollo. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ForwardedHeadersTest.RequestInfo.class)
class UntrustedProxyTest {

    private static final Path DB_DIR = createTempDir();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("untrusted.sqlite").toString());
        // Un solo proxy fidato, che non e' il client del test (127.0.0.1).
        registry.add("server.tomcat.remoteip.internal-proxies", () -> "10\\.99\\.99\\.99");
    }

    @LocalServerPort
    int port;

    @Test
    void forwardedHeadersFromAnUntrustedSourceAreIgnored() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/test/request-info"))
                .header("X-Forwarded-Proto", "https")
                .header("X-Forwarded-For", "100.64.0.7")
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode info = new ObjectMapper().readTree(response.body());
        assertThat(info.get("scheme").asText()).isEqualTo("http");
        assertThat(info.get("secure").asBoolean()).isFalse();
        assertThat(info.get("remote").asText()).isEqualTo("127.0.0.1");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-untrusted-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
