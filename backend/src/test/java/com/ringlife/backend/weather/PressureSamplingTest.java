package com.ringlife.backend.weather;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.OptionalDouble;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.ringlife.backend.ha.HaPublisher;
import com.ringlife.backend.plugin.PluginService;

/** Letture di pressione, variazione in 24 ore e campionamento (ADR 0017). Dati sintetici. */
@SpringBootTest
class PressureSamplingTest {

    private static final Path DB_DIR = createTempDir();
    private static final Instant NOW = Instant.parse("2026-11-04T08:00:00Z");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RINGLIFE_DB_PATH", () -> DB_DIR.resolve("weather.sqlite").toString());
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PressureRepository repository;

    @Autowired
    PressureService service;

    @Autowired
    UvRepository uvRepository;

    @Autowired
    UvService uvService;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM weather_sample");
        jdbc.update("DELETE FROM uv_sample");
    }

    private static long ms(Instant at) {
        return at.toEpochMilli();
    }

    @Test
    void changeIsTheLatestReadingMinusTheOneFromADayBefore() {
        repository.save(ms(NOW), 1008);
        repository.save(ms(NOW.minus(Duration.ofHours(24))), 1015);
        assertThat(service.change24h(NOW).getAsDouble()).isEqualTo(-7);
    }

    @Test
    void usesTheNearestReadingWithinNinetyMinutes() {
        repository.save(ms(NOW.minus(Duration.ofMinutes(80))), 1010);
        repository.save(ms(NOW.minus(Duration.ofHours(24)).plus(Duration.ofMinutes(20))), 1016);
        repository.save(ms(NOW.minus(Duration.ofHours(24)).minus(Duration.ofMinutes(70))), 990);
        assertThat(service.change24h(NOW).getAsDouble()).isEqualTo(-6);
    }

    @Test
    void withoutBothReadingsThereIsNoChange() {
        assertThat(service.change24h(NOW)).isEmpty();
        repository.save(ms(NOW), 1010);
        assertThat(service.change24h(NOW)).isEmpty();
        repository.save(ms(NOW.minus(Duration.ofHours(24)).minus(Duration.ofMinutes(91))), 1015);
        assertThat(service.change24h(NOW)).isEmpty();
    }

    @Test
    void theDatabaseRefusesImplausiblePressure() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> repository.save(ms(NOW), 5)).isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    private WeatherSampler sampler(WeatherSettings settings, WeatherClient client, PluginService plugins, HaPublisher publisher) {
        return new WeatherSampler(settings, client, repository, uvRepository, plugins, publisher, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static WeatherSettings settings(String entity, String token) {
        return new WeatherSettings(entity, "http://supervisor/core/api/", token);
    }

    @Test
    void aSampleIsSavedThenPluginsAndEntitiesAreRefreshed() {
        WeatherClient client = mock(WeatherClient.class);
        when(client.currentPressureHpa()).thenReturn(OptionalDouble.of(1021.5));
        PluginService plugins = mock(PluginService.class);
        HaPublisher publisher = mock(HaPublisher.class);

        assertThat(sampler(settings("weather.casa", "t"), client, plugins, publisher).sample()).isTrue();

        assertThat(jdbc.queryForObject("SELECT pressure_hpa FROM weather_sample WHERE ts = ?", Double.class, ms(NOW))).isEqualTo(1021.5);
        verify(plugins).evaluateEveryDevice();
        verify(publisher).publishLatestDevice();
    }

    @Test
    void oldReadingsAreDeleted() {
        repository.save(ms(NOW.minus(Duration.ofDays(91))), 1000);
        repository.save(ms(NOW.minus(Duration.ofDays(10))), 1000);
        WeatherClient client = mock(WeatherClient.class);
        when(client.currentPressureHpa()).thenReturn(OptionalDouble.of(1010));

        sampler(settings("weather.casa", "t"), client, mock(PluginService.class), mock(HaPublisher.class)).sample();

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM weather_sample", Integer.class)).isEqualTo(2);
    }

    @Test
    void withoutEntityOrTokenNothingHappens() {
        WeatherClient client = mock(WeatherClient.class);
        PluginService plugins = mock(PluginService.class);
        assertThat(sampler(settings("", "t"), client, plugins, mock(HaPublisher.class)).sample()).isFalse();
        assertThat(sampler(settings("weather.casa", ""), client, plugins, mock(HaPublisher.class)).sample()).isFalse();
        verify(client, never()).currentPressureHpa();
        verify(plugins, never()).evaluateEveryDevice();
    }

    @Test
    void aFailureOrAnEmptyReadingSavesNothingAndNeverThrows() {
        PluginService plugins = mock(PluginService.class);
        WeatherClient failing = mock(WeatherClient.class);
        when(failing.currentPressureHpa()).thenThrow(new WeatherUnavailableException("ConnectException"));
        assertThat(sampler(settings("weather.casa", "t"), failing, plugins, mock(HaPublisher.class)).sample()).isFalse();

        WeatherClient empty = mock(WeatherClient.class);
        when(empty.currentPressureHpa()).thenReturn(OptionalDouble.empty());
        assertThat(sampler(settings("weather.casa", "t"), empty, plugins, mock(HaPublisher.class)).sample()).isFalse();

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM weather_sample", Integer.class)).isZero();
        verify(plugins, times(0)).evaluateEveryDevice();
    }

    @Test
    void theUvIndexIsSavedEvenWithoutPressureAndReadBackInOrder() {
        WeatherClient client = mock(WeatherClient.class);
        when(client.currentPressureHpa()).thenReturn(OptionalDouble.empty());
        when(client.currentUvIndex()).thenReturn(OptionalDouble.of(5.5));
        PluginService plugins = mock(PluginService.class);

        assertThat(sampler(settings("weather.casa", "t"), client, plugins, mock(HaPublisher.class)).sample()).isTrue();

        uvRepository.save(ms(NOW.minus(Duration.ofHours(2))), 3);
        assertThat(uvService.between(NOW.minus(Duration.ofHours(3)), NOW.plusSeconds(1)))
                .containsExactly(new UvReading(NOW.minus(Duration.ofHours(2)), 3), new UvReading(NOW, 5.5));
        assertThat(uvService.between(NOW.minus(Duration.ofHours(3)), NOW)).hasSize(1);
        verify(plugins).evaluateEveryDevice();
    }

    @Test
    void aFailingUvReadingDoesNotStopThePressure() {
        WeatherClient client = mock(WeatherClient.class);
        when(client.currentPressureHpa()).thenReturn(OptionalDouble.of(1012));
        when(client.currentUvIndex()).thenThrow(new WeatherUnavailableException("ConnectException"));

        assertThat(sampler(settings("weather.casa", "t"), client, mock(PluginService.class), mock(HaPublisher.class)).sample()).isTrue();

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM weather_sample", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM uv_sample", Integer.class)).isZero();
    }

    @Test
    void theDatabaseRefusesAnImplausibleUvIndex() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> uvRepository.save(ms(NOW), 30)).isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    @Test
    void settingsKeepTheUvSensorApart() {
        WeatherSettings settings = new WeatherSettings("weather.casa", " sensor.uv ", "", "t");
        assertThat(settings.uvEntity()).isEqualTo("sensor.uv");
        assertThat(settings("weather.casa", "t").uvEntity()).isEmpty();
    }

    @Test
    void settingsNormalizeTheApiUrl() {
        assertThat(settings("weather.casa", "t").apiUrl()).isEqualTo("http://supervisor/core/api");
        assertThat(new WeatherSettings("weather.casa", "", "t").apiUrl()).isEqualTo("http://supervisor/core/api");
    }

    private static Path createTempDir() {
        try {
            return Files.createTempDirectory("ringlife-test");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
