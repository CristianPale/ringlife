package com.ringlife.backend.common;

import org.springframework.http.HttpStatus;

/** Errore di richiesta con il suo codice HTTP. Il messaggio non contiene mai dati sanitari. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }
}
