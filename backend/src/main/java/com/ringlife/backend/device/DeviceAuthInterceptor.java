package com.ringlife.backend.device;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import com.ringlife.backend.common.ApiException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.util.Map;

/**
 * Controlla il token Bearer sulle rotte `/api/v1/devices/{deviceId}/...`. Un token vale solo per il proprio
 * dispositivo: con il token di un altro telefono si riceve lo stesso 401 di un token sbagliato.
 */
@Component
class DeviceAuthInterceptor implements HandlerInterceptor {

    static final String BEARER = "Bearer ";

    private final TokenService tokens;

    DeviceAuthInterceptor(TokenService tokens) {
        this.tokens = tokens;
    }

    @Override
    @SuppressWarnings("unchecked")
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String header = request.getHeader("Authorization");
        String token = header != null && header.startsWith(BEARER) ? header.substring(BEARER.length()).trim() : null;
        Map<String, String> variables =
                (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        String pathDevice = variables == null ? null : variables.get("deviceId");
        boolean ok = tokens.deviceFor(token).filter(device -> device.equals(pathDevice)).isPresent();
        if (!ok) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Token non valido");
        }
        return true;
    }
}
