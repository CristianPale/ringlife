package com.ringlife.backend.diary;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.diary.DiaryDtos.DiaryRequest;
import com.ringlife.backend.diary.DiaryDtos.DiaryResult;
import com.ringlife.backend.diary.DiaryDtos.DiaryView;
import com.ringlife.backend.ha.HaPublisher;
import com.ringlife.backend.plugin.PluginService;

/** Sync del diario dal telefono (ADR 0010). L'autenticazione e' nell'interceptor del dispositivo. */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/diary")
class DiaryController {

    private final DiaryService service;
    private final DiaryValidator validator;
    private final PluginService plugins;
    private final HaPublisher publisher;
    private final AlertService alerts;

    DiaryController(DiaryService service, DiaryValidator validator, PluginService plugins, HaPublisher publisher, AlertService alerts) {
        this.service = service;
        this.validator = validator;
        this.plugins = plugins;
        this.publisher = publisher;
        this.alerts = alerts;
    }

    /** Il diario salvato, per ripristinarlo su un telefono nuovo. */
    @GetMapping
    DiaryView read(@PathVariable String deviceId) {
        return service.read(deviceId);
    }

    @PutMapping
    DiaryResult sync(@PathVariable String deviceId, @RequestBody DiaryRequest request) {
        validator.validate(request);
        DiaryResult result = service.apply(deviceId, request);
        // I plugin che leggono il diario si rivalutano subito (ADR 0014). Non lanciano mai: il diario e' gia' salvo.
        plugins.evaluateAll(deviceId);
        // Un rischio emicrania salito con il diario diventa un avviso subito (ADR 0045).
        alerts.evaluateToday(deviceId);
        publisher.publish(deviceId);
        return result;
    }
}
