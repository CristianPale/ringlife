package com.ringlife.backend.weather;

/** HA non ha risposto come previsto. Il messaggio e' solo il tipo dell'errore di origine. */
class WeatherUnavailableException extends RuntimeException {

    WeatherUnavailableException(String cause) {
        super(cause);
    }
}
