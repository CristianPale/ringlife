package com.ringlife.backend.alert;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.alert.AlertDtos.ConfigView;
import com.ringlife.backend.alert.AlertDtos.CustomRequest;
import com.ringlife.backend.alert.AlertDtos.EventsView;
import com.ringlife.backend.alert.AlertDtos.SeenRequest;
import com.ringlife.backend.alert.AlertDtos.SeenView;
import com.ringlife.backend.alert.AlertDtos.UpdateRequest;
import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.ha.HaPublisher;

/**
 * Alerts (ADR 0045, 0046): configuration, your own rules, events, seen. Authentication is in the device interceptor. When the alerts are
 * published in Home Assistant, a change that touches them is published right away.
 */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}/alerts")
class AlertController {

    private final AlertService service;
    private final HaPublisher publisher;

    AlertController(AlertService service, HaPublisher publisher) {
        this.service = service;
        this.publisher = publisher;
    }

    @GetMapping("/config")
    ConfigView config(@PathVariable String deviceId) {
        return service.config(deviceId);
    }

    @PutMapping("/config")
    ConfigView update(@PathVariable String deviceId, @RequestBody UpdateRequest request) {
        boolean before = service.publishesToHomeAssistant(deviceId);
        ConfigView view = service.update(deviceId, request);
        boolean after = view.settings().homeAssistant();
        if (after) {
            // New events of today, or the entity just switched on.
            publisher.publish(deviceId);
        } else if (before) {
            publisher.removeAlerts();
        }
        return view;
    }

    /** A rule of yours (ADR 0046); answers with the whole configuration. */
    @PostMapping("/custom")
    ConfigView createCustom(@PathVariable String deviceId, @RequestBody CustomRequest request) {
        return published(deviceId, service.createCustom(deviceId, request));
    }

    @PutMapping("/custom/{ruleId}")
    ConfigView updateCustom(@PathVariable String deviceId, @PathVariable String ruleId, @RequestBody CustomRequest request) {
        return published(deviceId, service.updateCustom(deviceId, ruleId, request));
    }

    /** Removes the rule; its events stay. */
    @DeleteMapping("/custom/{ruleId}")
    ConfigView deleteCustom(@PathVariable String deviceId, @PathVariable String ruleId) {
        return service.deleteCustom(deviceId, ruleId);
    }

    /** A change of your rules may create events of today: Home Assistant shows them right away when it is on. */
    private ConfigView published(String deviceId, ConfigView view) {
        if (view.settings().homeAssistant()) {
            publisher.publish(deviceId);
        }
        return view;
    }

    @GetMapping
    EventsView events(@PathVariable String deviceId, @RequestParam(required = false) String since) {
        Long from = null;
        if (since != null) {
            try {
                from = Long.parseLong(since);
            } catch (NumberFormatException e) {
                throw ApiException.badRequest("Parametro non valido: since");
            }
        }
        return service.events(deviceId, from);
    }

    @PostMapping("/seen")
    SeenView seen(@PathVariable String deviceId, @RequestBody SeenRequest request) {
        SeenView view = service.markSeen(deviceId, request);
        if (view.marked() > 0 && service.publishesToHomeAssistant(deviceId)) {
            publisher.publish(deviceId);
        }
        return view;
    }
}
