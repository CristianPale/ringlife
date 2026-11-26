package com.ringlife.backend.plugin;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.plugin.PluginService.PluginView;

/** Plugin e risultati (ADR 0013). L'autenticazione e' nell'interceptor del dispositivo. */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/plugins")
class PluginController {

    /** `enabled` e `config` assenti restano come sono. */
    record UpdateRequest(Boolean enabled, Map<String, Object> config) {}

    private final PluginService service;

    PluginController(PluginService service) {
        this.service = service;
    }

    @GetMapping
    List<PluginView> list(@PathVariable String deviceId, @RequestParam(required = false) String day) {
        LocalDate date = null;
        if (day != null) {
            try {
                date = LocalDate.parse(day);
            } catch (DateTimeParseException e) {
                throw ApiException.badRequest("Giorno non valido: usa AAAA-MM-GG");
            }
        }
        return service.list(deviceId, date);
    }

    @PutMapping("/{pluginId}")
    PluginView update(@PathVariable String deviceId, @PathVariable String pluginId, @RequestBody UpdateRequest request) {
        return service.update(deviceId, pluginId, request.enabled(), request.config());
    }
}
