package com.ringlife.backend.weather;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.ObjectMapper;

/** Conversione e lettura della pressione (ADR 0017). Valori sintetici. */
class PressureUnitsTest {

    @Test
    void convertsKnownUnitsToHpa() {
        assertThat(PressureUnits.toHpa(1013, "hPa").getAsDouble()).isEqualTo(1013);
        assertThat(PressureUnits.toHpa(1013, "mbar").getAsDouble()).isEqualTo(1013);
        assertThat(PressureUnits.toHpa(101.3, "kPa").getAsDouble()).isCloseTo(1013, org.assertj.core.data.Offset.offset(0.01));
        assertThat(PressureUnits.toHpa(101300, "Pa").getAsDouble()).isCloseTo(1013, org.assertj.core.data.Offset.offset(0.01));
        assertThat(PressureUnits.toHpa(29.92, "inHg").getAsDouble()).isCloseTo(1013.2, org.assertj.core.data.Offset.offset(0.2));
        assertThat(PressureUnits.toHpa(760, "mmHg").getAsDouble()).isCloseTo(1013.2, org.assertj.core.data.Offset.offset(0.2));
    }

    @Test
    void aMissingUnitMeansHpa() {
        assertThat(PressureUnits.toHpa(1020, null).getAsDouble()).isEqualTo(1020);
    }

    @Test
    void unknownUnitsAndImplausibleValuesAreRejected() {
        assertThat(PressureUnits.toHpa(1013, "bar")).isEmpty();
        assertThat(PressureUnits.toHpa(799.9, "hPa")).isEmpty();
        assertThat(PressureUnits.toHpa(1100.1, "hPa")).isEmpty();
        assertThat(PressureUnits.toHpa(Double.NaN, "hPa")).isEmpty();
        assertThat(PressureUnits.toHpa(1013, "Pa")).isEmpty();
    }

    @Test
    void readsThePressureAttributeOfAWeatherState() throws Exception {
        ObjectMapper json = new ObjectMapper();
        assertThat(SupervisorWeatherClient.parse(json.readTree("{\"state\":\"cloudy\",\"attributes\":{\"pressure\":1022.7,\"pressure_unit\":\"hPa\"}}")).getAsDouble())
                .isEqualTo(1022.7);
        assertThat(SupervisorWeatherClient.parse(json.readTree("{\"attributes\":{\"pressure\":102.27,\"pressure_unit\":\"kPa\"}}")).getAsDouble())
                .isCloseTo(1022.7, org.assertj.core.data.Offset.offset(0.01));
        assertThat(SupervisorWeatherClient.parse(json.readTree("{\"attributes\":{\"temperature\":12}}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parse(json.readTree("{\"attributes\":{\"pressure\":\"alta\"}}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parse(json.readTree("{}"))).isEmpty();
    }

    @Test
    void readsTheUvIndexFromTheWeatherEntityOrFromAUvSensor() {
        ObjectMapper json = new ObjectMapper();
        assertThat(SupervisorWeatherClient.parseUvAttribute(json.readTree("{\"attributes\":{\"uv_index\":4.5}}")).getAsDouble()).isEqualTo(4.5);
        assertThat(SupervisorWeatherClient.parseUvAttribute(json.readTree("{\"attributes\":{\"pressure\":1010}}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parseUvAttribute(json.readTree("{\"attributes\":{\"uv_index\":45}}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parseUvSensor(json.readTree("{\"state\":\"6.2\"}")).getAsDouble()).isEqualTo(6.2);
        assertThat(SupervisorWeatherClient.parseUvSensor(json.readTree("{\"state\":\"unavailable\"}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parseUvSensor(json.readTree("{\"state\":\"-1\"}"))).isEmpty();
        assertThat(SupervisorWeatherClient.parseUvSensor(json.readTree("{}"))).isEmpty();
    }
}
