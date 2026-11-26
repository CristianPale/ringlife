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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Dietro Tailscale Serve (ADR 0005) il backend deve vedere l'indirizzo e il protocollo veri del client, ma solo se
 * la richiesta arriva da un proxy fidato. Serve un server vero: MockMvc non passa da Tomcat.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ForwardedHeadersTest.RequestInfo.class)
class ForwardedHeadersTest {

    private static final Path DB_DIR = createTempDir();

    @RestController
    static class RequestInfo {
        @GetMapping("/test/request-info")
        String info(HttpServletRequest request) {
            return "{\"scheme\":\"" + request.getScheme() + "\",\"secure\":" + request.isSecure() + ",\"remote\":\""
                    + request.getRemoteAddr() + "\"}";
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("forwarded.sqlite").toString());
    }

    @LocalServerPort
    int port;

    private JsonNode call(String... headers) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/test/request-info"));
        for (int i = 0; i < headers.length; i += 2) {
            request.header(headers[i], headers[i + 1]);
        }
        HttpResponse<String> response = HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return new ObjectMapper().readTree(response.body());
    }

    @Test
    void withoutAProxyTheRequestIsSeenAsItIs() throws Exception {
        JsonNode info = call();
        assertThat(info.get("scheme").asText()).isEqualTo("http");
        assertThat(info.get("secure").asBoolean()).isFalse();
        assertThat(info.get("remote").asText()).isEqualTo("127.0.0.1");
    }

    @Test
    void aLocalProxyTellsTheRealClientAndProtocol() throws Exception {
        // La richiesta arriva dal loopback (come Tailscale Serve sull'host): e' un proxy fidato.
        JsonNode info = call("X-Forwarded-Proto", "https", "X-Forwarded-For", "100.64.0.7");
        assertThat(info.get("scheme").asText()).isEqualTo("https");
        assertThat(info.get("secure").asBoolean()).isTrue();
        assertThat(info.get("remote").asText()).isEqualTo("100.64.0.7");
    }

    @Test
    void theProtocolAloneIsEnough() throws Exception {
        JsonNode info = call("X-Forwarded-Proto", "https");
        assertThat(info.get("secure").asBoolean()).isTrue();
        assertThat(info.get("remote").asText()).isEqualTo("127.0.0.1");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-forwarded-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
